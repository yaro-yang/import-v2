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

// 构建 Prompt（按文件类型定制）
function buildAnalyzePrompt(request: AIAnalyzeRequest): string {
  const typeSpecific = getTypeSpecificPrompt(request.fileType);
  return `你是一个物流单据分析专家。请分析以下${request.fileType.toUpperCase()}格式的出库单/配送单文件内容，并生成解析规则。

## 文件信息
- 文件名: ${request.fileName}
- 文件类型: ${request.fileType}

## 文件内容（前N行样本）
${request.fileContent}

${typeSpecific}

## 收货信息规则（重要）
A组（门店模式）：只需填写"收货门店"
B组（收件人模式）：需填写"收件人姓名 + 收件人电话 + 收件人地址"
两组至少填一组。两组都填也可以。

## 任务要求
1. 识别数据区起始位置（跳过干扰头部行，0-based）
2. 识别表头行位置（0-based）
3. 识别每个字段对应哪一列/哪个位置
4. 识别是否需要按外部编码聚合多行（同一配送单号下多行物品共享收货信息）
5. 识别是否有尾部额外信息（如收货人信息在数据区之外的独立行或文件末尾）
6. 识别是否有合计行需要跳过
7. 识别是否有多个Sheet需要合并处理
8. 识别是否矩阵格式（门店名/日期作为列头横向排列）需要转置
9. 识别是否卡片式布局（每条记录是独立"卡片"区域，有起始标志）
10. 识别是否有复合单元格需要拆分（一个单元格内含"物品名x数量"的复合值）
11. 对于Word/PDF纯文本：识别记录分隔标志、物品行格式、字段位置

## 输出格式
请以JSON格式输出（只输出JSON，不要其他内容），结构如下：
{
  "skipRows": 数字,
  "headerRow": 数字,
  "fieldMappings": [
    {
      "targetField": "字段名(skuCode/skuName/skuQuantity/skuSpec/storeName/recipientName/recipientPhone/recipientAddress/externalCode/remark)",
      "mode": "column_index 或 column_name 或 static_value 或 tail_extract 或 row_field 或 regex_extract",
      "columnIndex": 数字或null,
      "columnName": "列名或null",
      "regexPattern": "正则或null",
      "regexGroup": 数字或null,
      "rowKeyPattern": "行键或null",
      "staticValue": "静态值或null",
      "confidence": 0.0-1.0,
      "note": "推测说明"
    }
  ],
  "groupByExternalCode": true/false,
  "externalCodeField": "externalCode",
  "hasTailInfo": true/false,
  "tailFields": [],
  "skipTotalRow": true/false,
  "totalRowPattern": "合计",
  "mergeSheets": true/false,
  "matrixMode": true/false,
  "cardMode": true/false,
  "cardStartMarker": "卡片起始标志",
  "compositeMode": true/false,
  "compositeSeparator": "分隔符",
  "textRecordMarker": "记录分隔标志（Word/PDF）",
  "textSeparator": "文本分隔符",
  "confidence": 0.0-1.0,
  "notes": "整体分析说明"
}`;
}

function getTypeSpecificPrompt(fileType: string): string {
  switch (fileType) {
    case "excel":
      return `## Excel 文件特殊处理
- 注意：第一行可能是标题行（非表头），需要跳过
- 可能有多行干扰头部（公司名称、日期、业务状态、配送信息等）
- 表头可能在第2-4行
- 注意合并单元格导致表头跨行
- 尾部可能包含收货人/电话/地址等散落信息
- 注意合计行（包含"合计"/"小计"字样）需要跳过
- 如果是SKU×门店矩阵格式（门店名列头横向展开），需要矩阵转置
- 如果是卡片式布局（有"调拨记录#N"等起始标志），需要卡片拆分
- 如果单元格内含"物品名x数量\\n物品名x数量"的复合值，需要复合单元格拆分
- 如果外部编码（配送单号）列存在，同编码的多行需要聚合为一条运单`;
    case "word":
      return `## Word 文档特殊处理
- Word文件通常为纯文本段落格式，没有结构化表格
- 每条记录可能用分隔线（如"━━━"）隔开
- 物品信息可能用"编号. 编码 | 名称 | 规格 | 数量"的文本行格式
- 收货人/电话/地址等信息在段落文本中
- 需要设置 textRecordMarker 来拆分不同记录
- 字段映射建议使用 regex_extract 或 row_field 模式`;
    case "pdf":
      return `## PDF 文档特殊处理
- PDF可能有头部大段业务元信息（单据编号、日期、机构等）
- 中间可能有标准表格（物品类别/编码/名称/数量等列）
- 底部可能有收货人签字区、收货人/电话/地址
- 一个PDF可能含多个独立配送单（用分隔线或页面区分）
- 合计行需要跳过
- 需要设置 textRecordMarker 来拆分不同配送单
- 字段映射建议混合使用 column_name 和 tail_extract`;
    default:
      return "";
  }
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
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

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
            content: "你是一个物流单据分析专家，擅长分析各种格式的Excel/Word/PDF出库单文件。请严格按照JSON格式输出分析结果，不要输出任何JSON以外的内容。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error("AI API error:", response.status, response.statusText);
      return heuristicAnalysis(request);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // 提取 JSON（多种匹配策略）
    let jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) jsonMatch = content.match(/```\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) jsonMatch = content.match(/(\{[\s\S]*\})/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return convertAIResponse(parsed, request);
      } catch (e) {
        console.error("JSON parse error:", e);
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
