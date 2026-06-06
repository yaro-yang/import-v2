// AI 大模型服务 - 用于分析文件结构并生成解析规则

import { AIAnalyzeRequest, AIAnalyzeResponse, FieldMapping } from "@/types";

// AI 模型配置
interface AIModelConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
}

// 兜底配置：未设置环境变量时使用（仅供个人项目/本地开发用，勿用于公开仓库）
const FALLBACK_AI_API_KEY = "sk-344f80af6b994b61a43fd514583deaca";
const FALLBACK_AI_API_URL = "https://api.deepseek.com/v1/chat/completions";
const FALLBACK_AI_MODEL = "deepseek-chat";

function getAIConfig(): AIModelConfig {
  return {
    apiKey: process.env.AI_API_KEY || FALLBACK_AI_API_KEY,
    apiUrl: process.env.AI_API_URL || FALLBACK_AI_API_URL,
    model: process.env.AI_MODEL || FALLBACK_AI_MODEL,
  };
}

// 构建 Prompt（引导 AI 输出精确的列名匹配）
function buildAnalyzePrompt(request: AIAnalyzeRequest): string {
  const contentPreview = request.fileContent.substring(0, 7000);
  const fileTypeHint = request.fileType === "excel"
    ? `这是Excel表格。注意以下多种布局模式：
   - 标准表：表头行含\u201c物品编码\u201d、\u201c名称\u201d、\u201c数量\u201d等列名，数据行紧接其后
   - 多区域布局：顶部元数据行（如\u201c调拨单号：xxx\u201d、\u201c收货机构：xxx\u201d），中间数据表，底部尾部信息（如\u201c收货人：xxx\u201d、\u201c电话：xxx\u201d）
   - 卡片式布局：由多个卡片组成，每张卡片以\u201c\u25b6 调拨记录 #N\u201d开头，卡片内包含门店/收货人信息+一张小数据表
   - 矩阵布局：前几列是SKU/物品信息（如仓库名称、货主名称、SKU名称、SKU条码等），后几列是门店名（如银泰、金银潭、金桥等），每个单元格是门店对应的数量。常见于库存分配表/配货表。
     * **矩阵库分配表重要特征：表头既没有"调拨单号/配送单号"，也没有"收货人/电话/地址"，文件本身就是货主对各门店的分配数量清单**
   - 复合单元格：一个单元格含\u201c\\n\u201d分隔的复合信息（如\u201c规格\u00d7数量\u201d）`
    : request.fileType === "word"
      ? "Word纯文本段落，注意段落间的结构化信息（收货人、地址、电话等）。"
      : "PDF文本。注意：可能是多页PDF，每页可能包含多个订单。注意文本中key: value对格式的信息。";

  return `你是出库单解析专家。分析以下${request.fileType.toUpperCase()}文件结构，输出JSON。

文件名: ${request.fileName}

${fileTypeHint}

内容:
${contentPreview}

重要规则：

1. headerRow: 表头所在行号(0-based)。
   - 标准表：表头行包含"物品编码/物品名称/规格/数量"等
   - **卡片式布局：必须设置 headerRow=0, skipRows=0**（由卡片分隔符 ▶ 决定结构，表头行不适用）

2. skipRows: headerRow之前需要跳过的行数。**卡片式必须为 0**。

3. fieldMappings: 每个字段的映射。columnName必须是表头行中的原始列名文字。
   - 标准表：从表头行找对应的列名，如"物品编码"、"SKU名称"、"调入门店"
   - **卡片式：SKU 字段的 columnName 直接填卡片内 SKU 小表的列名（如"物品编码"、"物品名称"、"数量"）**
   - 卡片式/多区域：如果在表头找不到，检查内容中是否有key:value对，如"调拨单号：xxx"，则columnName填"调拨单号"
   - 矩阵布局：SKU字段从前面标准列中映射；storeName由矩阵转置自动填充门店列名；**externalCode如果表中找不到任何单号字段，confidence填0.1，columnName填null，并在notes中说明"矩阵分配表无外部单号，可用文件名替代"**

4. 特殊模式检测（非常重要）：
   a) cardMode: true —— 如果内容包含"▶ 调拨记录"、"▶ 配送记录"等卡片分隔符
      - **卡片式必须将 cardMode.enabled 设为 true, startMarker 设为 "▶"**
      - **卡片式不要设置 tailRegion（每张卡片内部已含收货门店/收货人/电话/地址信息，由卡片解析器自动提取）**
   b) matrixMode: true —— 表头包含≥2个门店名（如"银泰"、"金桥"、"金银潭"），且这些列在表头靠后位置
      - **矩阵模式如果表中完全找不到 externalCode、recipientName、recipientPhone、recipientAddress 的对应列，confidence 设为 0.1，columnName 设为 null，不要强行猜测**
   c) compositeMode: true —— 如果表格单元格包含"\n"换行分隔的复合信息
   d) groupByExternalCode: true —— 如果多个仓库配送单合并到一个文件中
   e) mergeSheets: true —— 如果有多个结构相同的Sheet

5. 尾部信息区（tailRegion）——**仅对标准表有效，卡片式和矩阵式不需要**:
   - 如果数据表下方有额外的信息行（如"收货人：xxx"、"电话：xxx"、"地址：xxx"、"收货门店：xxx"、"单据号：xxx"），
     这些应提取到tailFields中
   - tailFields格式：[{targetField, mode: "row_field", rowKeyPattern: "收货人|收货人姓名", staticValue: null, confidence: 0.8}]
   - tailStartRow: 尾部信息起始行号。如果有合计行，tailStartRow在合计行之后

6. storeName(收货门店)优先匹配含"调入/门店/收货店/店铺/客户/收货机构"等关键词的列名
   - **矩阵模式：storeName来自矩阵列名转置，columnName可填null，由矩阵转置自动处理**
7. recipientName/recipientPhone/recipientAddress优先从尾部信息区提取（卡片式则由卡片解析器自动处理）
   - **矩阵库存分配表通常没有收件人信息，这三项直接填null，confidence=0.1**

输出纯JSON,不要markdown代码块,不要解释:
{
  "headerRow": 数字,
  "skipRows": 数字,
  "fieldMappings": [
    {"targetField": "skuCode", "mode": "column_name", "columnName": "...", "confidence": 0.8},
    {"targetField": "skuName", "mode": "column_name", "columnName": "...", "confidence": 0.8},
    {"targetField": "skuQuantity", "mode": "column_name", "columnName": "...", "confidence": 0.8},
    {"targetField": "skuSpec", "mode": "column_name", "columnName": null, "confidence": 0.3},
    {"targetField": "storeName", "mode": "column_name", "columnName": null, "confidence": 0.3},
    {"targetField": "externalCode", "mode": "column_name", "columnName": null, "confidence": 0.3},
    {"targetField": "recipientName", "mode": "column_name", "columnName": null, "confidence": 0.2},
    {"targetField": "recipientPhone", "mode": "column_name", "columnName": null, "confidence": 0.2},
    {"targetField": "recipientAddress", "mode": "column_name", "columnName": null, "confidence": 0.2},
    {"targetField": "remark", "mode": "column_name", "columnName": null, "confidence": 0.2}
  ],
  "tailFields": [],
  "tailStartRow": null,
  "groupByExternalCode": false,
  "skipTotalRow": false,
  "mergeSheets": false,
  "matrixMode": false,
  "cardMode": false,
  "compositeMode": false,
  "cardStartMarker": "▶ 调拨记录",
  "confidence": 0.7,
  "notes": "简要说明文件布局模式和关键发现"
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

// 启发式分析（无 AI 或 AI 失败时的回退方案）
function heuristicAnalysis(request: AIAnalyzeRequest): AIAnalyzeResponse {
  const content = request.fileContent;
  const lines = content.split("\n").filter((l) => l.trim());
  const mappings: AIAnalyzeResponse["fieldMappings"] = [];

  // 扩展关键词映射
  const commonMappings: Record<string, { keywords: string[]; priority: number }> = {
    skuCode: { keywords: ["编码", "物品编码", "SKU", "产品编码", "商品编码", "货号", "条码", "SKU条码"], priority: 1 },
    skuName: { keywords: ["名称", "物品名称", "品名", "产品名称", "商品名称", "SKU名称"], priority: 2 },
    skuQuantity: { keywords: ["数量", "发货数量", "件数", "出库数量", "配送数量", "订货数量"], priority: 3 },
    skuSpec: { keywords: ["规格", "型号", "规格型号", "单位", "库存单位"], priority: 4 },
    storeName: { keywords: ["调入门店", "调入方", "收货门店", "门店", "店铺", "客户名称", "收货单位", "收货机构"], priority: 5 },
    recipientName: { keywords: ["收件人", "收货人", "联系人", "收件人姓名"], priority: 6 },
    recipientPhone: { keywords: ["电话", "手机", "联系方式", "收件人电话", "联系电话", "收货人手机号"], priority: 7 },
    recipientAddress: { keywords: ["地址", "收货地址", "收件人地址", "详细地址"], priority: 8 },
    externalCode: { keywords: ["调拨单号", "配送单号", "单据号", "单据编号", "订单号", "外部编码", "运单号", "单号"], priority: 9 },
    remark: { keywords: ["备注", "说明", "附注"], priority: 10 },
  };

  // ===== 第一步：检测文件结构模式 =====
  // 1a) 卡片模式：包含 ▶ 标记
  const isCardMode = content.includes("▶") && (content.includes("调拨记录") || content.includes("配送记录"));

  // 1b) 多Sheet：内容包含2个以上 "--- Sheet:"
  const sheetCount = (content.match(/--- Sheet:/g) || []).length;
  const isMultiSheet = request.fileType === "excel" && sheetCount >= 2;

  // 1c) 矩阵模式：表头行含2个以上门店名（如"银泰"、"金桥"、"金银潭"等）
  const storeNameKeywords = ["店", "门店", "分店", "银泰", "金桥", "金银潭"];

  // 1d) 合计行
  const hasTotalRow = content.includes("合计") || content.includes("小计");

  // ===== 第二步：在所有行中搜索外部编码关键词 =====
  let externalCodeMatchedKeyword: string | null = null;
  let externalCodeMatchedLineIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    for (const kw of commonMappings.externalCode.keywords) {
      if (lines[i].includes(kw)) {
        if (!externalCodeMatchedKeyword || kw.length > externalCodeMatchedKeyword.length) {
          externalCodeMatchedKeyword = kw;
          externalCodeMatchedLineIdx = i;
        }
      }
    }
  }

  // ===== 第三步：检测表头行 =====
  const headerCandidates: { lineIdx: number; matches: number }[] = [];
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const line = lines[i];
    // 跳过非表头行：包含 "："/":" 的元数据行（如"调拨单号：xxx"）
    const hasFullColon = /[：:]\S/.test(line);
    if (hasFullColon && !line.includes(" | ") && !line.includes("\t")) continue;

    let matches = 0;
    for (const [, info] of Object.entries(commonMappings)) {
      for (const kw of info.keywords) {
        if (line.includes(kw)) {
          matches++;
          break;
        }
      }
    }
    if (matches >= 2) {
      headerCandidates.push({ lineIdx: i, matches });
    }
  }

  headerCandidates.sort((a, b) => b.matches - a.matches);
  const headerRow = headerCandidates.length > 0 ? headerCandidates[0].lineIdx : 0;
  const skipRows = headerRow > 0 ? headerRow : 0;
  const headerLine = lines[headerRow] || "";

  // ===== 第四步：检测尾部信息区（合计行之后含收货人/店等key:value对的行）=====
  let tailStartRow = -1;
  const tailLines: { lineIdx: number; text: string }[] = [];

  if (hasTotalRow) {
    // 在合计行之后找 tail 信息
    let foundTotal = false;
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      if (lines[i].includes("合计") || lines[i].includes("小计")) {
        foundTotal = true;
        continue;
      }
      if (foundTotal && lines[i].trim()) {
        // 检查是否包含收货人/电话/地址/门店等关键信息
        const hasTailInfo = ["收货人", "电话", "地址", "收货门店", "单据", "联系", "收货机构", "备注", "签字"].some(
          (kw) => lines[i].includes(kw)
        );
        if (hasTailInfo) {
          if (tailStartRow < 0) tailStartRow = i;
          tailLines.push({ lineIdx: i, text: lines[i] });
        }
      }
    }
  }

  // 检测矩阵模式的数量列（表头行中超出标准字段的列名可能是门店名）
  const headerParts = headerLine.split(" | ").map((p) => p.trim());
  const standardHeaderKeywords = ["编码", "名称", "数量", "规格", "单位", "SKU", "条码", "库存", "状态", "备注", "序号", "分类", "品牌", "仓库", "日期", "货主", "商品", "分配", "结余", "在库", "可用", "待移", "移入", "冻结"];
  let matrixStoreColumns: string[] = [];

  // 矩阵列检测：不只检查后半部分，而是扫描所有列，找出看起来是门店/分店名称的列
  // 门店列特征：(1) 不属于标准业务字段 (2) 包含门店关键词或看起来像专有名称
  const storeNamePatterns = ["店", "门店", "分店", "商场", "银泰", "金桥", "金银潭", "万象", "万达", "广场", "世纪"];
  const isLikelyStoreName = (col: string): boolean => {
    const trimmed = col.trim();
    if (!trimmed) return false;
    // 如果是标准字段关键词，跳过
    if (standardHeaderKeywords.some((kw) => trimmed.includes(kw))) return false;
    // 如果包含门店模式关键词，是门店列
    if (storeNamePatterns.some((kw) => trimmed.includes(kw))) return true;
    // 如果列名很短（2-4字）且在表头最后几列（>=4列之后），可能是简称门店名
    if (trimmed.length >= 2 && trimmed.length <= 4 && headerParts.length >= 10) return false; // 太短且无关键词的不确定
    return false;
  };

  for (const part of headerParts) {
    if (isLikelyStoreName(part)) {
      matrixStoreColumns.push(part);
    }
  }

  // 扩展检测：如果 headerParts 数量 >= 10，最后几列可能是不含关键词的门店名（如"银泰"已经被上面的 pattern 覆盖）
  // 如果矩阵列数量不足但列数多，再检查最后 1/4 的列中短小精悍的列名
  if (matrixStoreColumns.length < 2 && headerParts.length >= 12) {
    const lastQuarter = headerParts.slice(Math.floor(headerParts.length * 0.75));
    for (const col of lastQuarter) {
      const trimmed = col.trim();
      if (trimmed && !standardHeaderKeywords.some((kw) => trimmed.includes(kw)) && trimmed.length <= 4 && trimmed.length >= 2) {
        if (!matrixStoreColumns.includes(trimmed)) {
          matrixStoreColumns.push(trimmed);
        }
      }
    }
  }

  // 检测是否为"纯矩阵库存分配表"——有门店列但没有任何外部编码、收货人、电话、地址字段
  // 这种文件（如欢乐牧场模板）的结构：SKU列在前 + 门店分配列在后，无外部单号和收件人信息
  const hasExternalCodeAnywhere = (() => {
    for (const kw of commonMappings.externalCode.keywords) {
      for (let i = 0; i < Math.min(lines.length, 30); i++) {
        if (lines[i].includes(kw)) return true;
      }
    }
    return false;
  })();
  const hasRecipientInfoAnywhere = (() => {
    const recipientKws = ["收货人", "收件人", "联系人", "电话", "联系电话", "地址", "收货地址", "收件人地址"];
    for (const kw of recipientKws) {
      for (let i = 0; i < Math.min(lines.length, 30); i++) {
        if (lines[i].includes(kw)) return true;
      }
    }
    return false;
  })();
  const isPureMatrixInventoryTable = matrixStoreColumns.length >= 2 && !hasExternalCodeAnywhere && !hasRecipientInfoAnywhere && !isCardMode;

  // ===== 第五步：生成字段映射 =====
  for (const [field, info] of Object.entries(commonMappings)) {
    let found = false;
    let matchedKeyword = "";
    let matchedLineIdx = headerRow;
    let matchMode: "header" | "nearby" | "tail" | "externalCode" | "matrix" | "filename" = "header";

    // ===== 纯矩阵库存分配表特殊处理 =====
    if (isPureMatrixInventoryTable) {
      if (field === "storeName") {
        // 矩阵模式：storeName 来自矩阵列名转置
        const storeColNames = matrixStoreColumns.slice(0, 5).join("/");
        mappings.push({
          targetField: field,
          suggestedSource: `矩阵门店列: ${storeColNames}${matrixStoreColumns.length > 5 ? "..." : ""}`,
          confidence: 0.75,
          note: `矩阵转置模式：${matrixStoreColumns.length}个门店列（${storeColNames}）自动拆分`,
        });
        continue;
      }
      if (field === "externalCode") {
        // 纯矩阵分配表没有外部单号，使用文件名作为兜底
        const baseName = request.fileName.replace(/\.[^.]+$/, "");
        mappings.push({
          targetField: field,
          suggestedSource: baseName,
          confidence: 0.5,
          note: `矩阵分配表无单号字段，使用文件名"${baseName}"作为外部编码`,
        });
        continue;
      }
      if (field === "skuQuantity") {
        // 矩阵模式：数量从门店列中取得
        mappings.push({
          targetField: field,
          suggestedSource: `矩阵门店列数量`,
          confidence: 0.65,
          note: `发货数量来自各门店列值（矩阵转置后自动聚合）`,
        });
        continue;
      }
      if (field.startsWith("recipient") || field === "recipientName" || field === "recipientPhone" || field === "recipientAddress") {
        // 纯矩阵分配表没有收件人信息
        mappings.push({
          targetField: field,
          suggestedSource: "",
          confidence: 0.1,
          note: "纯矩阵分配表无收件人信息",
        });
        continue;
      }
    }

    // 先在表头行搜索
    for (const keyword of info.keywords) {
      if (headerLine.includes(keyword)) {
        matchedKeyword = keyword;
        found = true;
        break;
      }
    }

    // 表头行没找到，在周围行搜索（非纯矩阵模式才需要搜索尾部/附近行）
    if (!found && !isPureMatrixInventoryTable) {
      // 对 storeName/recipient fields 优先搜索尾部的 key:value 对
      if ((field === "storeName" || field.startsWith("recipient")) && tailLines.length > 0) {
        const tailKw = field === "storeName" ? ["收货门店", "收货机构", "门店"]
          : field === "recipientName" ? ["收货人", "联系人"]
          : field === "recipientPhone" ? ["电话", "联系电话", "手机"]
          : ["地址", "收货地址"];
        for (const tl of tailLines) {
          for (const kw of tailKw) {
            if (tl.text.includes(kw)) {
              matchedKeyword = kw;
              matchedLineIdx = tl.lineIdx;
              found = true;
              matchMode = "tail";
              break;
            }
          }
          if (found) break;
        }
      }

      // 如果 tail 没找到，在表头附近搜索
      if (!found) {
        for (let i = Math.max(0, headerRow - 3); i <= Math.min(lines.length - 1, headerRow + 3); i++) {
          for (const keyword of info.keywords) {
            if (lines[i].includes(keyword)) {
              matchedKeyword = keyword;
              matchedLineIdx = i;
              found = true;
              matchMode = "nearby";
              break;
            }
          }
          if (found) break;
        }
      }
    }

    // externalCode 特殊处理：如果所有搜索都没找到，使用 step 1 结果（非矩阵模式）
    if (!found && field === "externalCode" && externalCodeMatchedKeyword) {
      matchedKeyword = externalCodeMatchedKeyword;
      matchedLineIdx = externalCodeMatchedLineIdx;
      found = true;
      matchMode = "externalCode";
    }

    // externalCode 兜底：矩阵模式下也没找到，使用文件名
    if (!found && field === "externalCode" && matrixStoreColumns.length >= 2) {
      const baseName = request.fileName.replace(/\.[^.]+$/, "");
      mappings.push({
        targetField: field,
        suggestedSource: baseName,
        confidence: 0.45,
        note: `矩阵模式未检测到单号字段，使用文件名"${baseName}"作为外部编码`,
      });
      continue;
    }

    // 提取列名文字
    let extractedColumnName: string | undefined;
    if (matchedKeyword) {
      extractedColumnName = extractColumnText(lines[matchedLineIdx], matchedKeyword);
    }

    // 通过尾部和外部编码模式找到的字段，用 row_field 模式（key:value）
    const isKeyValueMode = matchMode === "tail" || matchMode === "externalCode";

    mappings.push({
      targetField: field,
      suggestedSource: extractedColumnName || (matchedKeyword ? `匹配: "${matchedKeyword}"` : ""),
      confidence: found ? (matchMode === "header" ? 0.7 : matchMode === "nearby" ? 0.4 : 0.5) : 0.25,
      note: isKeyValueMode
        ? `从行${matchedLineIdx + 1}提取"${extractedColumnName || matchedKeyword}"`
        : extractedColumnName
          ? `从${matchedLineIdx + 1}行列头提取"${extractedColumnName}"`
          : `基于关键词"${matchedKeyword}"推测(行${matchedLineIdx + 1})`,
    });
  }

  // ===== 第六步：构建 tailRegion 的 fields 配置 =====
  const tailFields: FieldMapping[] = [];
  const tailFieldDefs: { targetField: string; keywords: string[] }[] = [
    { targetField: "storeName", keywords: ["收货门店", "收货机构", "门店"] },
    { targetField: "recipientName", keywords: ["收货人", "联系人"] },
    { targetField: "recipientPhone", keywords: ["电话", "联系电话", "收货电话", "手机"] },
    { targetField: "recipientAddress", keywords: ["地址", "收货地址"] },
  ];

  if (tailLines.length > 0 && !isPureMatrixInventoryTable) {
    for (const tfd of tailFieldDefs) {
      for (const tl of tailLines) {
        for (const kw of tfd.keywords) {
          if (tl.text.includes(kw)) {
            tailFields.push({
              targetField: tfd.targetField,
              mode: "row_field",
              rowKeyPattern: kw,
            });
            break;
          }
        }
      }
    }
  }

  // 检测是否为矩阵模式
  const isMatrixMode = matrixStoreColumns.length >= 2;

  // ===== 第七步：构建建议的解析规则 =====
  const baseName = request.fileName.replace(/\.[^.]+$/, "");
  const suggestedRuleFieldMappings: FieldMapping[] = mappings.map((m) => {
    // 在矩阵模式下，storeName 来自矩阵列名转置
    if (isPureMatrixInventoryTable && m.targetField === "storeName") {
      return {
        targetField: m.targetField,
        mode: "matrix_transpose" as FieldMapping["mode"],
        columnName: `矩阵门店列(${matrixStoreColumns.join("/")})`,
      };
    }
    if (isPureMatrixInventoryTable && m.targetField === "skuQuantity") {
      return {
        targetField: m.targetField,
        mode: "matrix_transpose" as FieldMapping["mode"],
        columnName: "矩阵门店列值(转置后自动填充)",
      };
    }
    // 矩阵模式：externalCode 用 static_value 填入文件名（表中无此列）
    if (isPureMatrixInventoryTable && m.targetField === "externalCode") {
      return {
        targetField: m.targetField,
        mode: "static_value" as FieldMapping["mode"],
        staticValue: baseName,
        defaultValue: baseName,
      };
    }
    return {
      targetField: m.targetField,
      mode: (m.targetField === "storeName" || m.targetField.startsWith("recipient"))
             && tailFields.some((tf) => tf.targetField === m.targetField)
             ? "row_field" as FieldMapping["mode"]
             : "column_name" as FieldMapping["mode"],
      columnName: extractCleanColumnName(m.suggestedSource),
    };
  });

  return {
    suggestedRule: {
      name: `${request.fileName} - 解析规则`,
      fileType: request.fileType,
      globalConfig: {
        groupByExternalCode: isPureMatrixInventoryTable ? false : !!externalCodeMatchedKeyword,
        externalCodeField: "externalCode",
        mergeSheets: isMultiSheet,
      },
      fieldMappings: suggestedRuleFieldMappings,
      dataRegion: {
        // 卡片模式：从第 0 行开始（包含标题/订单头），headerRow 不适用
        skipRows: isCardMode ? 0 : skipRows,
        headerRow: isCardMode ? 0 : headerRow,
        tailRegion: tailLines.length > 0 && !isCardMode && !isPureMatrixInventoryTable
          ? { startRow: tailStartRow, fields: tailFields }
          : undefined,
        cardMode: isCardMode
          ? { enabled: true, startMarker: "▶" }
          : undefined,
        matrixMode: isMatrixMode
          ? { enabled: true, valueColumnNamesRow: headerRow }
          : undefined,
      },
      postProcessing: {
        skipTotalRow: hasTotalRow,
        totalRowPattern: "合计",
      },
      aiGenerated: false,
      aiConfidence: isPureMatrixInventoryTable ? 0.55 : 0.4,
      aiNotes: isPureMatrixInventoryTable
        ? `矩阵库存分配表：表头行${headerRow + 1}，${matrixStoreColumns.length}个门店列(${matrixStoreColumns.slice(0,5).join("/")})，无外部单号/收件人信息`
        : `启发式分析：表头行${headerRow + 1}${tailLines.length > 0 ? `，尾部信息行${tailStartRow + 1}` : ""}${isCardMode ? "，卡片模式" : ""}${isMatrixMode ? "，矩阵模式" : ""}`,
    },
    confidence: isPureMatrixInventoryTable ? 0.55 : 0.4,
    notes: isPureMatrixInventoryTable
      ? `矩阵库存分配表：识别到${matrixStoreColumns.length}个门店列，无外部单号/收件人信息，外部编码使用文件名`
      : `基于启发式规则分析，识别到表头行${headerRow + 1}${tailLines.length > 0 ? `，尾部信息行${tailStartRow + 1}` : ""}${isCardMode ? "，卡片模式" : ""}`,
    fieldMappings: mappings,
  };
}

/**
 * 从文本行中提取包含目标关键词的"列名"文字
 * 例如行内容: "行5: 调拨单号 | 调入门店 | 收货人 | 电话 | 地址"
 * keyword: "调入门店" → 返回 "调入门店"
 * 例如行内容: "行2: 调拨单号：DB20260530001 | 调出仓库：武汉配送中心"
 * keyword: "调拨单号" → 返回 "调拨单号"（去掉冒号后面的值）
 */
function extractColumnText(lineText: string, keyword: string): string {
  // Excel 文本格式通常是 "行N: 值1 | 值2 | 值3" 或 tab 分隔
  const separators = [" | ", "\t", "|", ","];
  for (const sep of separators) {
    if (lineText.includes(sep)) {
      const parts = lineText.split(sep).map((p) => p.trim());
      for (const part of parts) {
        // 去掉 "行N:" 前缀后检查
        const cleanPart = part.replace(/^行\d+:\s*/, "");
        if (cleanPart.includes(keyword)) {
          // 如果这个部分以"keyword：值"形式出现（如"调拨单号：DB20260530001"），
          // 截断冒号后的值，只返回关键词部分作为列名
          const colonIdx = cleanPart.indexOf("：");
          const semicIdx = cleanPart.indexOf(":");
          const cutIdx = colonIdx >= 0 ? colonIdx : semicIdx >= 0 ? semicIdx : -1;
          const namePart = cutIdx >= 0 ? cleanPart.substring(0, cutIdx).trim() : cleanPart.trim();
          if (namePart.includes(keyword) && namePart.length <= 30 && namePart.length >= 1) {
            return namePart;
          }
          // 如果截断后太短或太长了，直接返回关键词
          if (cleanPart.includes(keyword)) {
            return keyword;
          }
        }
      }
    }
  }
  // 如果没有分隔符但包含关键词，直接返回整行清理后的结果
  const cleaned = lineText.replace(/^行\d+:\s*/, "").trim();
  if (cleaned.includes(keyword)) {
    // 同样截断冒号
    const colonIdx = cleaned.indexOf("：");
    const semicIdx = cleaned.indexOf(":");
    const cutIdx = colonIdx >= 0 ? colonIdx : semicIdx >= 0 ? semicIdx : -1;
    const namePart = cutIdx >= 0 ? cleaned.substring(0, cutIdx).trim() : cleaned;
    if (namePart.length <= 50 && namePart.includes(keyword)) {
      return namePart;
    }
  }
  return keyword; // fallback
}

/**
 * 从 suggestedSource 中提取干净的列名文字
 * 例如 "调入门店" → "调入门店"
 * 例如 '匹配: "调入门店"' → "调入门店"
 */
function extractCleanColumnName(suggestedSource: string): string | undefined {
  if (!suggestedSource) return undefined;
  // 如果不包含冒号等前缀，说明已经是干净的列名
  if (!suggestedSource.includes("匹配:") && !suggestedSource.includes("列") && !suggestedSource.includes("行")) {
    return suggestedSource;
  }
  // 从 "匹配: \"xxx\"" 中提取 xxx
  const match = suggestedSource.match(/匹配:\s*"?([^"]+)"?/);
  if (match) return match[1];
  return undefined;
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
  const isAIResultMatrixMode = !!(parsed.matrixMode);

  const fieldMappingsFull: FieldMapping[] = rawMappings.map((m) => {
    const targetField = (m.targetField as string) || "";
    const rawMode = (m.mode as FieldMapping["mode"]) || "column_name";

    // 矩阵模式下：storeName 和 skuQuantity 需要使用 matrix_transpose 模式
    let mode = rawMode;
    if (isAIResultMatrixMode) {
      if (targetField === "storeName" || targetField === "skuQuantity") {
        mode = "matrix_transpose";
      }
    }

    return {
      targetField,
      mode,
      columnIndex: m.columnIndex as number | undefined,
      columnName: (m.columnName as string) || undefined,
      regexPattern: m.regexPattern as string | undefined,
      regexGroup: m.regexGroup as number | undefined,
      rowKeyPattern: m.rowKeyPattern as string | undefined,
      staticValue: m.staticValue as string | undefined,
      defaultValue: m.defaultValue as string | undefined,
    };
  });

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
