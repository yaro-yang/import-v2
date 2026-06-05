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

// 构建 Prompt
function buildAnalyzePrompt(request: AIAnalyzeRequest): string {
  return `你是一个物流单据分析专家。请分析以下${request.fileType.toUpperCase()}格式的出库单/配送单文件内容，并生成解析规则。

## 文件信息
- 文件名: ${request.fileName}
- 文件类型: ${request.fileType}

## 文件内容（前N行样本）
${request.fileContent}

## 需要提取的字段
必填字段：
- skuCode: SKU物品编码
- skuName: SKU物品名称
- skuQuantity: SKU发货数量（正数）

选填字段：
- externalCode: 外部编码（配送单号等）
- storeName: 收货门店
- recipientName: 收件人姓名
- recipientPhone: 收件人电话
- recipientAddress: 收件人地址
- skuSpec: SKU规格型号
- remark: 备注

## 收货信息规则（重要）
A组（门店模式）：只需填写"收货门店"
B组（收件人模式）：需填写"收件人姓名 + 收件人电话 + 收件人地址"
两组至少填一组。

## 任务要求
1. 识别数据区起始位置（跳过干扰头部行）
2. 识别表头行位置
3. 识别每个字段对应哪一列/哪个位置
4. 识别是否需要按外部编码聚合多行
5. 识别是否有尾部额外信息（如收货人信息在数据区之外）
6. 识别是否有合计行需要跳过
7. 识别是否有多个Sheet
8. 识别是否矩阵格式需要转置
9. 识别是否卡片式布局
10. 识别是否有复合单元格需要拆分

## 输出格式
请以JSON格式输出，结构如下：
\`\`\`json
{
  "skipRows": 数字,  // 需要跳过的干扰头部行数
  "headerRow": 数字,  // 表头所在行（0-based）
  "dataStartRow": 数字,  // 数据起始行
  "fieldMappings": [
    {
      "targetField": "字段名",
      "mode": "column_index 或 column_name 或 static_value 或 tail_extract",
      "columnIndex": 数字或null,
      "columnName": "列名或null",
      "staticValue": "静态值或null",
      "defaultValue": "默认值或null",
      "confidence": 0.0-1.0,
      "note": "推测说明"
    }
  ],
  "groupByExternalCode": true/false,
  "externalCodeField": "用于聚合的字段名",
  "hasTailInfo": true/false,
  "tailFields": [],
  "skipTotalRow": true/false,
  "totalRowPattern": "合计行匹配模式",
  "mergeSheets": true/false,
  "matrixMode": true/false,
  "cardMode": true/false,
  "confidence": 0.0-1.0,
  "notes": "整体分析说明"
}
\`\`\`

请确保JSON格式正确，可以直接解析。`;
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
            content: "你是一个物流单据分析专家，擅长分析各种格式的Excel/Word/PDF出库单文件。请严格按照JSON格式输出分析结果。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      console.error("AI API error:", response.status, response.statusText);
      return heuristicAnalysis(request);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // 提取 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      return convertAIResponse(parsed, request);
    }

    return heuristicAnalysis(request);
  } catch (error) {
    console.error("AI analysis error:", error);
    return heuristicAnalysis(request);
  }
}

// 启发式分析（无 AI 时的回退方案）
function heuristicAnalysis(request: AIAnalyzeRequest): AIAnalyzeResponse {
  const content = request.fileContent;
  const lines = content.split("\n");
  const mappings: AIAnalyzeResponse["fieldMappings"] = [];

  // 简单启发式：查找常见列名关键词
  const commonMappings: Record<string, string[]> = {
    skuCode: ["编码", "物品编码", "SKU", "产品编码", "商品编码", "货号"],
    skuName: ["名称", "物品名称", "品名", "产品名称", "商品名称"],
    skuQuantity: ["数量", "发货数量", "件数", "出库数量", "配送数量"],
    skuSpec: ["规格", "型号", "规格型号"],
    storeName: ["门店", "收货门店", "店铺", "客户名称", "收货单位"],
    recipientName: ["收件人", "收货人", "联系人", "收件人姓名"],
    recipientPhone: ["电话", "手机", "联系方式", "收件人电话", "联系电话"],
    recipientAddress: ["地址", "收货地址", "收件人地址", "详细地址"],
    externalCode: ["单号", "订单号", "配送单号", "外部编码", "运单号"],
    remark: ["备注", "说明", "附注"],
  };

  for (const [field, keywords] of Object.entries(commonMappings)) {
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const line = lines[i];
      for (const keyword of keywords) {
        if (line.includes(keyword)) {
          mappings.push({
            targetField: field,
            suggestedSource: `列名匹配: "${keyword}"`,
            confidence: 0.5,
            note: `基于关键词"${keyword}"推测`,
          });
          break;
        }
      }
      if (mappings.some((m) => m.targetField === field)) break;
    }
  }

  return {
    suggestedRule: {
      globalConfig: {
        groupByExternalCode: false,
      },
      dataRegion: {
        skipRows: 0,
        headerRow: 0,
      },
    },
    confidence: 0.3,
    notes: "基于启发式规则分析（未使用AI），建议手动调整字段映射",
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
            : "未知",
      confidence: (m.confidence as number) || 0.5,
      note: (m.note as string) || "",
    });
  }

  return {
    suggestedRule: {
      name: `${request.fileName} - AI生成规则`,
      fileType: request.fileType,
      globalConfig: {
        groupByExternalCode: (parsed.groupByExternalCode as boolean) || false,
        externalCodeField: (parsed.externalCodeField as string) || "externalCode",
        mergeSheets: (parsed.mergeSheets as boolean) || false,
      },
      fieldMappings: (parsed.fieldMappings as FieldMapping[]) || [],
      dataRegion: {
        skipRows: (parsed.skipRows as number) || 0,
        headerRow: (parsed.headerRow as number) || 0,
        tailRegion: parsed.hasTailInfo
          ? {
              fields: (parsed.tailFields as FieldMapping[]) || [],
            }
          : undefined,
        cardMode: parsed.cardMode
          ? { enabled: true, startMarker: "" }
          : undefined,
        matrixMode: parsed.matrixMode
          ? { enabled: true }
          : undefined,
      },
      postProcessing: {
        skipTotalRow: (parsed.skipTotalRow as boolean) || false,
        totalRowPattern: (parsed.totalRowPattern as string) || "合计",
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
