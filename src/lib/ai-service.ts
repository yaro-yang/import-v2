// AI 大模型服务 - 用于分析文件结构并生成解析规则

import { AIAnalyzeRequest, AIAnalyzeResponse, FieldMapping } from "@/types";

// AI 模型配置
interface AIModelConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
}

function getAIConfig(): AIModelConfig {
  return {
    apiKey: process.env.AI_API_KEY || "",
    apiUrl: process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions",
    model: process.env.AI_MODEL || "gpt-4o-mini",
  };
}

// 构建 Prompt（简化版，提高 DeepSeek 免费模型的成功率）
function buildAnalyzePrompt(request: AIAnalyzeRequest): string {
  const contentPreview = request.fileContent.substring(0, 6000);
  return `你是出库单解析专家。分析以下${request.fileType.toUpperCase()}文件，输出JSON。

文件名: ${request.fileName}

${request.fileType === "excel" ? "Excel表格，第一行可能是标题行（非表头），表头通常在第2-4行。注意跳过公司名称、日期等干扰头部行。" : request.fileType === "word" ? "Word纯文本段落，每条记录可能用分隔线隔开。" : "PDF文本，可能有头部元信息、中间表格、底部收货信息。"}

内容:
${contentPreview}

目标字段: skuCode(编码)、skuName(名称)、skuQuantity(数量)、skuSpec(规格)、storeName(门店)、recipientName(收件人)、recipientPhone(电话)、recipientAddress(地址)、externalCode(单号)、remark(备注)

输出JSON（不要其他内容）:
{
  "headerRow": 表头行号(0-based),
  "skipRows": 表头前需跳过的行数,
  "fieldMappings": [
    {"targetField": "字段名", "mode": "column_name", "columnName": "列名", "confidence": 0.8, "note": "依据"}
  ],
  "groupByExternalCode": true/false,
  "skipTotalRow": true/false,
  "totalRowPattern": "合计",
  "mergeSheets": true/false,
  "matrixMode": true/false,
  "cardMode": true/false,
  "cardStartMarker": "",
  "compositeMode": true/false,
  "compositeSeparator": "\\n",
  "textRecordMarker": "",
  "textSeparator": "",
  "confidence": 0.7,
  "notes": "简要说明"
}`;
}

// 调用 AI 分析文件
export async function analyzeFileWithAI(
  request: AIAnalyzeRequest
): Promise<AIAnalyzeResponse> {
  const config = getAIConfig();

  if (!config.apiKey) {
    // 没有 API Key 时，返回基于启发式规则的默认分析
    return heuristicAnalysis(request);
  }

  try {
    const prompt = buildAnalyzePrompt(request);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: "你是出库单解析专家。只输出JSON，不要解释，不要markdown代码块，直接输出纯JSON对象。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("AI API error:", response.status, errText.substring(0, 200));
      return heuristicAnalysis(request);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // 提取 JSON（多种容错策略）
    let jsonStr = content.trim();

    // 策略1: 去掉 markdown 代码块
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1];

    // 策略2: 尝试直接解析
    try {
      const parsed = JSON.parse(jsonStr);
      return convertAIResponse(parsed, request);
    } catch {
      // 策略3: 找到第一个 { 和最后一个 }
      const braceStart = jsonStr.indexOf("{");
      const braceEnd = jsonStr.lastIndexOf("}");
      if (braceStart >= 0 && braceEnd > braceStart) {
        try {
          const parsed = JSON.parse(jsonStr.substring(braceStart, braceEnd + 1));
          return convertAIResponse(parsed, request);
        } catch {
          // 继续尝试
        }
      }
      // 策略4: 尝试修复常见 JSON 错误（未闭合的字符串、尾逗号等）
      try {
        const fixed = fixCommonJSON(jsonStr);
        const parsed = JSON.parse(fixed);
        return convertAIResponse(parsed, request);
      } catch {
        console.error("All JSON parse strategies failed, raw:", jsonStr.substring(0, 500));
      }
    }

    return heuristicAnalysis(request);
  } catch (error) {
    console.error("AI analysis error:", error);
    return heuristicAnalysis(request);
  }
}

// 启发式分析（无 AI 时的回退方案）- 增强版
function heuristicAnalysis(request: AIAnalyzeRequest): AIAnalyzeResponse {
  const content = request.fileContent;
  const lines = content.split("\n").filter((l) => l.trim());
  const mappings: AIAnalyzeResponse["fieldMappings"] = [];

  // 扩展关键词映射
  const commonMappings: Record<string, { keywords: string[]; priority: number }> = {
    skuCode: { keywords: ["编码", "物品编码", "SKU", "产品编码", "商品编码", "货号", "条码", "SKU条码"], priority: 1 },
    skuName: { keywords: ["名称", "物品名称", "品名", "产品名称", "商品名称", "SKU名称"], priority: 2 },
    skuQuantity: { keywords: ["数量", "发货数量", "件数", "出库数量", "配送数量", "订货数量", "出库数量"], priority: 3 },
    skuSpec: { keywords: ["规格", "型号", "规格型号", "单位", "库存单位"], priority: 4 },
    storeName: { keywords: ["门店", "收货门店", "店铺", "客户名称", "收货单位", "收货机构", "调入门店"], priority: 5 },
    recipientName: { keywords: ["收件人", "收货人", "联系人", "收件人姓名"], priority: 6 },
    recipientPhone: { keywords: ["电话", "手机", "联系方式", "收件人电话", "联系电话", "收货人手机号"], priority: 7 },
    recipientAddress: { keywords: ["地址", "收货地址", "收件人地址", "详细地址", "收货地址"], priority: 8 },
    externalCode: { keywords: ["单号", "订单号", "配送单号", "外部编码", "运单号", "单据号", "调拨单号", "单据编号"], priority: 9 },
    remark: { keywords: ["备注", "说明", "附注"], priority: 10 },
  };

  // 分析表头行
  const headerCandidates: { lineIdx: number; matches: number; headerKeywords: string[] }[] = [];
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i];
    let matches = 0;
    const headerKeywords: string[] = [];
    for (const [, info] of Object.entries(commonMappings)) {
      for (const kw of info.keywords) {
        if (line.includes(kw)) {
          matches++;
          headerKeywords.push(kw);
        }
      }
    }
    if (matches >= 2) {
      headerCandidates.push({ lineIdx: i, matches, headerKeywords });
    }
  }

  // 选择匹配最多的行作为表头
  headerCandidates.sort((a, b) => b.matches - a.matches);
  const headerRow = headerCandidates.length > 0 ? headerCandidates[0].lineIdx : 0;
  const skipRows = headerRow > 0 ? headerRow - 1 : 0;

  // 分析是否矩阵格式（门店名列头横向展开）
  const isMatrix = content.includes("门店") && (
    lines.some((l) => l.includes("银泰") && l.includes("金桥")) ||
    lines.some((l) => l.includes("门店B") || l.includes("门店D"))
  );

  // 分析是否卡片式
  const isCardMode = content.includes("▶") || content.includes("调拨记录");

  // 分析是否有多Sheet
  const isMultiSheet = request.fileType === "excel" && content.includes("Sheet");

  // 分析是否有合计行
  const hasTotalRow = content.includes("合计") || content.includes("小计");

  // 分析是否有复合单元格
  const hasComposite = content.includes("x") && (content.includes("\\n") || content.includes("\n"));

  // 生成字段映射
  const headerLine = lines[headerRow] || "";
  for (const [field, info] of Object.entries(commonMappings)) {
    let found = false;
    for (const keyword of info.keywords) {
      if (headerLine.includes(keyword)) {
        mappings.push({
          targetField: field,
          suggestedSource: `列名匹配: "${keyword}"`,
          confidence: 0.5 + info.priority * 0.03,
          note: `基于关键词"${keyword}"在表头行${headerRow + 1}推测`,
        });
        found = true;
        break;
      }
    }
    if (!found) {
      // 在周围行搜索
      for (let i = Math.max(0, headerRow - 2); i <= Math.min(lines.length - 1, headerRow + 2); i++) {
        for (const keyword of info.keywords) {
          if (lines[i].includes(keyword)) {
            mappings.push({
              targetField: field,
              suggestedSource: `行${i + 1}匹配: "${keyword}"`,
              confidence: 0.35,
              note: `基于关键词"${keyword}"在行${i + 1}推测`,
            });
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  }

  return {
    suggestedRule: {
      globalConfig: {
        groupByExternalCode: content.includes("配送单号") || content.includes("单号"),
        externalCodeField: "externalCode",
        mergeSheets: isMultiSheet,
      },
      dataRegion: {
        skipRows,
        headerRow,
        matrixMode: isMatrix ? { enabled: true } : undefined,
        cardMode: isCardMode ? { enabled: true, startMarker: "▶" } : undefined,
        compositeMode: hasComposite ? { enabled: true, separator: "\n", pattern: "(.+?)x(\\d+)" } : undefined,
      },
      postProcessing: {
        skipTotalRow: hasTotalRow,
        totalRowPattern: "合计",
      },
    },
    confidence: 0.4,
    notes: `基于启发式规则分析（未使用AI），识别到表头行${headerRow + 1}，${isMatrix ? "矩阵格式" : isCardMode ? "卡片式布局" : "标准表格"}，建议手动调整字段映射`,
    fieldMappings: mappings,
  };
}

// 修复常见 JSON 格式错误
function fixCommonJSON(json: string): string {
  let result = json;
  // 修复未闭合的字符串（简单处理：在末尾补双引号如果奇数个）
  // 移除尾逗号
  result = result.replace(/,(\s*[}\]])/g, "$1");
  // 修复单引号
  // 不做太复杂的修复，这些是常见情况
  return result;
}

// 转换 AI 响应
function convertAIResponse(
  parsed: Record<string, unknown>,
  request: AIAnalyzeRequest
): AIAnalyzeResponse {
  const fieldMappings: AIAnalyzeResponse["fieldMappings"] = [];
  const rawMappings = (parsed.fieldMappings as Array<Record<string, unknown>>) || [];

  for (const m of rawMappings) {
    fieldMappings.push({
      targetField: (m.targetField as string) || "",
      suggestedSource: m.columnName
        ? `列: "${m.columnName}"`
        : m.columnIndex !== null && m.columnIndex !== undefined
          ? `第${Number(m.columnIndex) + 1}列`
          : m.staticValue
            ? `静态值: "${m.staticValue}"`
            : m.rowKeyPattern
              ? `行匹配: "${m.rowKeyPattern}"`
              : m.regexPattern
                ? `正则: "${m.regexPattern}"`
                : "未知",
      confidence: (m.confidence as number) || 0.5,
      note: (m.note as string) || "",
    });
  }

  // 转换原始 mappings 为 FieldMapping 数组
  const fieldMappingsFull: FieldMapping[] = rawMappings.map((m) => ({
    targetField: (m.targetField as string) || "",
    mode: (m.mode as FieldMapping["mode"]) || "column_name",
    columnIndex: m.columnIndex as number | undefined,
    columnName: m.columnName as string | undefined,
    regexPattern: m.regexPattern as string | undefined,
    regexGroup: m.regexGroup as number | undefined,
    rowKeyPattern: m.rowKeyPattern as string | undefined,
    staticValue: m.staticValue as string | undefined,
    defaultValue: m.defaultValue as string | undefined,
  }));

  const tailFields: FieldMapping[] = (parsed.tailFields as FieldMapping[]) || [];
  const hasTailInfo = (parsed.hasTailInfo as boolean) || tailFields.length > 0;

  return {
    suggestedRule: {
      name: `${request.fileName} - AI生成规则`,
      fileType: request.fileType,
      globalConfig: {
        groupByExternalCode: (parsed.groupByExternalCode as boolean) || false,
        externalCodeField: (parsed.externalCodeField as string) || "externalCode",
        mergeSheets: (parsed.mergeSheets as boolean) || false,
      },
      fieldMappings: fieldMappingsFull,
      dataRegion: {
        skipRows: (parsed.skipRows as number) || 0,
        headerRow: (parsed.headerRow as number) || 0,
        tailRegion: hasTailInfo
          ? {
              startRow: (parsed.tailStartRow as number) || undefined,
              fields: tailFields,
            }
          : undefined,
        cardMode: parsed.cardMode
          ? { enabled: true, startMarker: (parsed.cardStartMarker as string) || "" }
          : undefined,
        matrixMode: parsed.matrixMode
          ? { enabled: true }
          : undefined,
        compositeMode: parsed.compositeMode
          ? { enabled: true, separator: (parsed.compositeSeparator as string) || "\n", pattern: "(.+?)x(\\d+)" }
          : undefined,
      },
      postProcessing: {
        skipTotalRow: (parsed.skipTotalRow as boolean) || false,
        totalRowPattern: (parsed.totalRowPattern as string) || "合计",
        textRecordMarker: (parsed.textRecordMarker as string) || undefined,
        textSeparator: (parsed.textSeparator as string) || undefined,
      },
      aiGenerated: true,
      aiConfidence: (parsed.confidence as number) || 0.5,
      aiNotes: (parsed.notes as string) || "",
    },
    confidence: (parsed.confidence as number) || 0.5,
    notes: (parsed.notes as string) || "",
    fieldMappings,
  };
}
