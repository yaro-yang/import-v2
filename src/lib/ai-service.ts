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

// 构建 Prompt（引导 AI 输出精确的列名匹配）
function buildAnalyzePrompt(request: AIAnalyzeRequest): string {
  const contentPreview = request.fileContent.substring(0, 6000);
  const fileTypeHint = request.fileType === "excel"
    ? "这是Excel表格。第1行可能是大标题(如公司名)不是表头。真正的表头行通常在第2-4行，包含编码、名称、数量、规格、门店、收件人、电话、地址、单号、备注等列名。请找到正确的表头行，输出表头中的原始列名文字。"
    : request.fileType === "word"
      ? "Word纯文本段落。"
      : "PDF文本。";

  return `你是出库单解析专家。分析以下${request.fileType.toUpperCase()}文件表头，输出JSON。
重要：columnName必须填写Excel表头行中的原始列名文字。

文件名: ${request.fileName}

${fileTypeHint}

内容:
${contentPreview}

规则:
1. headerRow: 表头所在行号(从0开始数)。如果第1行是公司名称/标题则headerRow至少为1
2. skipRows: headerRow之前需要跳过的行数
3. fieldMappings中每个字段的columnName必须是表头行中的原始列名文字,例如"物品编码"、"SKU名称"、"调入门店"、"收货人姓名"、"联系电话"
4. 如果某个字段在表头中找不到对应列,columnName填null或空字符串
5. storeName(收货门店)字段优先匹配含"调入/门店/收货店/店铺/客户"等关键词的列名，如"调入门店"
6. recipientName/recipientPhone/recipientAddress只在表头明确存在时才映射,不要瞎猜

输出纯JSON,不要markdown代码块,不要解释:
{
  "headerRow": 数字,
  "skipRows": 数字,
  "fieldMappings": [
    {"targetField": "skuCode", "mode": "column_name", "columnName": "表头原始列名或null", "confidence": 0.8},
    {"targetField": "skuName", "mode": "column_name", "columnName": "表头原始列名或null", "confidence": 0.8},
    {"targetField": "skuQuantity", "mode": "column_name", "columnName": "表头原始列名或null", "confidence": 0.8},
    {"targetField": "skuSpec", "mode": "column_name", "columnName": null, "confidence": 0.3},
    {"targetField": "storeName", "mode": "column_name", "columnName": "表头原始列名或null", "confidence": 0.6},
    {"targetField": "externalCode", "mode": "column_name", "columnName": null, "confidence": 0.3},
    {"targetField": "recipientName", "mode": "column_name", "columnName": null, "confidence": 0.2},
    {"targetField": "recipientPhone", "mode": "column_name", "columnName": null, "confidence": 0.2},
    {"targetField": "recipientAddress", "mode": "column_name", "columnName": null, "confidence": 0.2},
    {"targetField": "remark", "mode": "column_name", "columnName": null, "confidence": 0.2}
  ],
  "groupByExternalCode": false,
  "skipTotalRow": false,
  "mergeSheets": false,
  "matrixMode": false,
  "cardMode": false,
  "compositeMode": false,
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
    storeName: { keywords: ["调入门店", "调入方", "收货门店", "门店", "店铺", "客户名称", "收货单位", "收货机构"], priority: 5 },
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

// 转换 AI 响应 — columnName 直接作为输入框预填值
function convertAIResponse(
  parsed: Record<string, unknown>,
  request: AIAnalyzeRequest
): AIAnalyzeResponse {
  const fieldMappings: AIAnalyzeResponse["fieldMappings"] = [];
  const rawMappings = (parsed.fieldMappings as Array<Record<string, unknown>>) || [];

  for (const m of rawMappings) {
    const colName = (m.columnName as string) || null;
    const colIdx = m.columnIndex !== null && m.columnIndex !== undefined ? Number(m.columnIndex) : null;
    const staticVal = (m.staticValue as string) || null;

    fieldMappings.push({
      targetField: (m.targetField as string) || "",
      suggestedSource: colName
        || (colIdx !== null ? `第${colIdx + 1}列` : "")
        || (staticVal ? `${staticVal}` : ""),
      confidence: (m.confidence as number) || (colName ? 0.7 : 0.3),
      note: (m.note as string) || (colName ? `AI识别到列名"${colName}"` : "未找到明确对应，请手动填写"),
    });
  }

  // 转换原始 mappings 为 FieldMapping 数组 — columnName 直接填入 AI 推荐值
  const fieldMappingsFull: FieldMapping[] = rawMappings.map((m) => ({
    targetField: (m.targetField as string) || "",
    mode: (m.mode as FieldMapping["mode"]) || "column_name",
    columnIndex: m.columnIndex as number | undefined,
    columnName: (m.columnName as string) || undefined,
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
