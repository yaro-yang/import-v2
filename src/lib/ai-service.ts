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
// 注：prompt 越短 AI 响应越快
function buildAnalyzePrompt(request: AIAnalyzeRequest): string {
  const contentPreview = request.fileContent.substring(0, 4000);
  const fileTypeHint = request.fileType === "excel"
    ? `Excel布局（识别其中一种）：
   - 标准表：表头含"物品编码/名称/数量"等，数据紧接其后
   - 多区域：表前/表后有key:value元数据行，中间是数据表
   - 卡片式：含"▶ 调拨记录"等分隔符，每张卡片内有收货门店/收货人/电话/地址
   - 矩阵式：表头含≥2个门店列（"银泰"等）且无收货人/电话，是库存分配表`
    : request.fileType === "word"
      ? "Word纯文本段落。"
      : "PDF文本。多页PDF每页可能含多个订单。注意key: value对。";

  return `你是出库单解析专家。分析${request.fileType.toUpperCase()}文件，输出纯JSON（无markdown代码块）。

文件名: ${request.fileName}

${fileTypeHint}

内容:
${contentPreview}

## 关键指令
**所有字段映射（columnName、rowKeyPattern）必须从文件实际内容中识别，不要照抄下面示例！**

## 规则
1. headerRow: 表头0-based行号。卡片式 headerRow=0, skipRows=0
2. fieldMappings:
   - **标准表**：SKU 字段（skuCode/skuName/skuQuantity/skuSpec）从表头找对应列名 → mode="column_name"
   - **表前/表后元数据**（storeName/externalCode/recipient*）：先看表头是否有该列名；
     - 有 → mode="column_name" + columnName=表头中的原列名
     - 没有但内容里有"调拨单号：xxx"等key:value形式 → mode="row_field" + rowKeyPattern=文件中实际出现的key（如"调拨单号"、"收货人"、"收货电话"等）
   - **卡片式**：SKU 字段对应卡片内小表表头（如"物品编码"），storeName/externalCode/recipient* 由 cardMode 模式自动从卡片内提取，**不写字段映射**（设 mode="column_name", columnName=null）
   - **矩阵式**：storeName/skuQuantity 用 mode="matrix_transpose"（自动处理），其他字段按上面规则
3. 模式标志：
   - 卡片式 → cardMode=true, cardStartMarker="▶ 调拨记录"（或文件中实际标记）
   - 矩阵式 → matrixMode=true
4. 找不到的字段 columnName=null, confidence=0.2

## 输出 JSON 结构（请按文件实际内容填值，不要照抄示例值）
{
  "headerRow": <表头行号>,
  "skipRows": <跳过的行数>,
  "fieldMappings": [
    {"targetField": "skuCode", "mode": "column_name", "columnName": "<文件表头中的列名>", "confidence": 0.8},
    {"targetField": "skuName", "mode": "column_name", "columnName": "<文件表头中的列名>", "confidence": 0.8},
    {"targetField": "skuQuantity", "mode": "column_name", "columnName": "<文件表头中的列名>", "confidence": 0.8},
    {"targetField": "skuSpec", "mode": "column_name", "columnName": "<文件表头中的列名或null>", "confidence": 0.3},
    {"targetField": "storeName", "mode": "<column_name|row_field|matrix_transpose>", "columnName": "<...或null>", "rowKeyPattern": "<...或undefined>", "confidence": 0.6},
    {"targetField": "externalCode", "mode": "<...>", "columnName": "<...或null>", "rowKeyPattern": "<...或undefined>", "confidence": 0.6},
    {"targetField": "recipientName", "mode": "<...>", "columnName": "<...或null>", "rowKeyPattern": "<...或undefined>", "confidence": 0.5},
    {"targetField": "recipientPhone", "mode": "<...>", "columnName": "<...或null>", "rowKeyPattern": "<...或undefined>", "confidence": 0.5},
    {"targetField": "recipientAddress", "mode": "<...>", "columnName": "<...或null>", "rowKeyPattern": "<...或undefined>", "confidence": 0.5},
    {"targetField": "remark", "mode": "column_name", "columnName": "<...或null>", "confidence": 0.2}
  ],
  "tailFields": [],
  "tailStartRow": null,
  "groupByExternalCode": false,
  "skipTotalRow": false,
  "mergeSheets": false,
  "matrixMode": <true|false>,
  "cardMode": <true|false>,
  "compositeMode": false,
  "cardStartMarker": "▶ 调拨记录",
  "confidence": 0.7,
  "notes": "<文件布局模式简述>"
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
            content: "出库单解析专家。快速分析文件结构并直接输出JSON（不要markdown代码块、不要解释）。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 1200,  // 减少 40% token，AI 响应更快
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

  // 扩展关键词映射（精确匹配关键词排在前面，宽泛的兜底关键词排最后）
  const commonMappings: Record<string, { keywords: string[]; priority: number }> = {
    skuCode: { keywords: ["SKU条码", "外部商品编码", "物品编码", "产品编码", "商品编码", "货号", "条码", "SKU", "编码"], priority: 1 },
    skuName: { keywords: ["SKU名称", "物品名称", "产品名称", "商品名称", "品名", "名称"], priority: 2 },
    skuQuantity: { keywords: ["发货数量", "出库数量", "配送数量", "订货数量", "件数", "数量"], priority: 3 },
    skuSpec: { keywords: ["规格型号", "规格", "型号", "库存单位", "单位"], priority: 4 },
    storeName: { keywords: ["调入门店", "收货门店", "调入方", "收货机构", "客户名称", "收货单位", "店铺", "门店"], priority: 5 },
    recipientName: { keywords: ["收货人", "收件人", "收件人姓名", "联系人"], priority: 6 },
    recipientPhone: { keywords: ["收货电话", "收货人手机号", "联系电话", "收件人电话", "联系方式", "手机", "电话"], priority: 7 },
    recipientAddress: { keywords: ["收货地址", "收件人地址", "详细地址", "地址"], priority: 8 },
    externalCode: { keywords: ["配送发货单", "发货单", "调拨单号", "配送单号", "单据编号", "单据号", "订单号", "外部编码", "运单号", "单号"], priority: 9 },
    remark: { keywords: ["备注", "说明", "附注"], priority: 10 },
  };

  // ===== 第一步：检测文件结构模式 =====
  // 1a) 卡片模式：包含 ▶ 标记
  const isCardMode = content.includes("▶") && (content.includes("调拨记录") || content.includes("配送记录"));

  // 1b) 多Sheet：内容包含2个以上 "--- Sheet:"
  const sheetCount = (content.match(/--- Sheet:/g) || []).length;
  const isMultiSheet = request.fileType === "excel" && sheetCount >= 2;

  // 1c) 矩阵模式：表头行含2个以上门店名（如"银泰"、"金桥"、"金银潭"等）

  // 1d) 合计行
  const hasTotalRow = content.includes("合计") || content.includes("小计");

  // ===== 第二步：在所有行中搜索外部编码关键词（按 cell 精确/前缀匹配，避免子串误判） =====
  let externalCodeMatchedKeyword: string | null = null;
  let externalCodeMatchedLineIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const lineCells = getDataCells(lines[i]);
    for (const kw of commonMappings.externalCode.keywords) {
      if (lineCells.some((c) => isCellMatchKeyword(c, kw))) {
        // 优先：更长的关键词（如"配送发货单"优先于"发货单"）；行号小的优先（与原行为一致）
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

    // 排除【...】元数据单元格（如【快递】物流单号、【自主】车牌号等）
    const dataCells = getDataCells(line);

    let matches = 0;
    for (const [, info] of Object.entries(commonMappings)) {
      // 仅按 cell 精确/前缀匹配统计，避免"发货单价"误匹配"发货单"等子串误判
      const fieldMatched = info.keywords.some((kw) => dataCells.some((c) => isCellMatchKeyword(c, kw)));
      if (fieldMatched) matches++;
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
  const matrixStoreColumns: string[] = [];

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
  // 同时记录门店列索引（0-based）
  const matrixStoreIndices: number[] = [];

  for (let i = 0; i < headerParts.length; i++) {
    if (isLikelyStoreName(headerParts[i])) {
      matrixStoreColumns.push(headerParts[i]);
      matrixStoreIndices.push(i);
    }
  }

  // 扩展检测：如果 headerParts 数量 >= 10，最后几列可能是不含关键词的门店名（如"银泰"已经被上面的 pattern 覆盖）
  // 如果矩阵列数量不足但列数多，再检查最后 1/4 的列中短小精悍的列名
  // **严格条件：必须包含门店相关关键词（店/分店/广场/万象/万达/世纪等）才能被识别为矩阵列**，
  // 否则容易误判"折前金额""促销折扣"等业务字段为门店。
  if (matrixStoreColumns.length < 2 && headerParts.length >= 12) {
    const lastQuarter = headerParts.slice(Math.floor(headerParts.length * 0.75));
    for (const col of lastQuarter) {
      const trimmed = col.trim();
      if (
        trimmed &&
        !standardHeaderKeywords.some((kw) => trimmed.includes(kw)) &&
        trimmed.length <= 4 &&
        trimmed.length >= 2 &&
        // 关键：必须包含门店模式关键词，避免误判价格/折扣等业务字段
        storeNamePatterns.some((kw) => trimmed.includes(kw))
      ) {
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
        // 纯矩阵分配表没有外部单号，外部编码留空
        mappings.push({
          targetField: field,
          suggestedSource: "",
          confidence: 0.4,
          note: "矩阵分配表无单号字段，外部编码留空",
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

    // 先在表头行搜索（按 cell 精确匹配；忽略【...】元数据单元格；不做纯子串匹配以避免"发货单价"误匹配"发货单"）
    const headerCells = getDataCells(headerLine);
    for (const keyword of info.keywords) {
      const match = headerCells.find((c) => isCellMatchKeyword(c, keyword));
      if (match) {
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
          : field === "recipientPhone" ? ["电话", "联系电话", "收货电话", "手机"]
          : ["地址", "收货地址"];
        for (const tl of tailLines) {
          const tailCells = getDataCells(tl.text);
          for (const kw of tailKw) {
            if (tailCells.some((c) => isCellMatchKeyword(c, kw))) {
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
          const lineCells = getDataCells(lines[i]);
          for (const keyword of info.keywords) {
            if (lineCells.some((c) => isCellMatchKeyword(c, keyword))) {
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

    // externalCode 兜底：矩阵模式下也没找到，外部编码留空
    if (!found && field === "externalCode" && matrixStoreColumns.length >= 2) {
      mappings.push({
        targetField: field,
        suggestedSource: "",
        confidence: 0.3,
        note: "矩阵模式未检测到单号字段，外部编码留空",
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
    { targetField: "externalCode", keywords: ["单据号", "配送单号", "配送发货单", "调拨单号", "单号"] },
  ];

  if (tailLines.length > 0 && !isPureMatrixInventoryTable) {
    for (const tfd of tailFieldDefs) {
      for (const tl of tailLines) {
        const tailCells = getDataCells(tl.text);
        for (const kw of tfd.keywords) {
          // 只匹配完整 cell 或 cell 起始处的"key：value"形式，避免"收货机构备注"误匹配"收货机构"
          if (tailCells.includes(kw) || tailCells.some((c) => c.startsWith(kw + "：") || c.startsWith(kw + ":"))) {
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
    // 矩阵模式：externalCode 用 static_value 留空（表中无此列，不应填文件名）
    if (isPureMatrixInventoryTable && m.targetField === "externalCode") {
      return {
        targetField: m.targetField,
        mode: "static_value" as FieldMapping["mode"],
        staticValue: "",
        defaultValue: "",
      };
    }
    // 查找列名在 headerParts 中的索引作为兜底
    const colName = extractCleanColumnName(m.suggestedSource);
    const colIdx = colName ? headerParts.findIndex((p) => p.replace(/^行\d+:\s*/, "").trim() === colName) : -1;

    // 模式判定：如果字段在表头中找到 → column_name；在尾部信息区 → row_field；
    // 在数据前区（既不在表头也不在尾部）→ tail_extract（由 excelToRawData 的前区扫描填充 tailFields）
    const isMetaField = m.targetField === "storeName" || m.targetField === "externalCode" || m.targetField.startsWith("recipient");
    const inTail = tailFields.some((tf) => tf.targetField === m.targetField);
    const mode: FieldMapping["mode"] = isMetaField
      ? (inTail ? "row_field" : colIdx >= 0 ? "column_name" : "row_field")
      : "column_name";

    return {
      targetField: m.targetField,
      mode,
      columnName: colName,
      columnIndex: colIdx >= 0 ? colIdx : undefined,
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
          ? { enabled: true, valueColumnNamesRow: headerRow, storeColumnNames: matrixStoreColumns, storeColumnIndices: matrixStoreIndices }
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
 * 从文本行中按" | "或"\t"分隔拆出 cell，并过滤掉【...】包裹的元数据单元格
 * （如【快递】物流单号、【自主】车牌号）。这些是快递公司/自主字段的元数据，
 * 不应作为数据表头参与匹配。
 */
function getDataCells(line: string): string[] {
  // 兼容多种分隔符：" | "、"|"、"\t"
  const parts = line.split(/\s*\|\s*|\t+/).map((p) => p.trim()).filter(Boolean);
  // 去掉开头的"行N: "前缀
  const cleaned = parts.map((p) => p.replace(/^行\d+:\s*/, "").trim()).filter(Boolean);
  // 过滤掉【...】元数据单元格
  return cleaned.filter((p) => !(p.startsWith("【") && p.includes("】")));
}

/**
 * 检查 cell 是否匹配关键词（避免"发货单价"被"发货单"误匹配等子串误判）
 * 匹配规则：
 *   1) cell === keyword（精确匹配）
 *   2) cell 以 keyword + 中文冒号/英文冒号 开头（label-value 格式，如"收货人：张三"）
 * 不做纯子串匹配，因为中文字符没有空格分隔，子串匹配会误判。
 */
function isCellMatchKeyword(cell: string, keyword: string): boolean {
  if (cell === keyword) return true;
  if (cell.startsWith(keyword + "：") || cell.startsWith(keyword + ":")) return true;
  return false;
}

/**
 * 从文本行中提取包含目标关键词的"列名"文字
 * 例如行内容: "行5: 调拨单号 | 调入门店 | 收货人 | 电话 | 地址"
 * keyword: "调入门店" → 返回 "调入门店"
 * 例如行内容: "行2: 调拨单号：DB20260530001 | 调出仓库：武汉配送中心"
 * keyword: "调拨单号" → 返回 "调拨单号"（去掉冒号后面的值）
 *
 * 当宽泛关键词（如"名称"、"编码"）匹配到多个候选列时，优先返回包含
 * SKU/物品/商品 等关键词的列，而非 仓库/货主/库存 等元数据列。
 */
function extractColumnText(lineText: string, keyword: string): string {
  const separators = [" | ", "\t", "|", ","];
  for (const sep of separators) {
    if (lineText.includes(sep)) {
      const parts = lineText.split(sep).map((p) => p.trim());
      // 过滤掉【...】元数据单元格，避免【快递】收货人手机号误匹配"收货人"
      const dataParts = parts.filter((p) => !(p.startsWith("【") && p.includes("】")));
      // 收集所有包含关键词的候选列
      const candidates: string[] = [];
      for (const part of dataParts) {
        const cleanPart = part.replace(/^行\d+:\s*/, "");
        if (cleanPart.includes(keyword)) {
          // 去掉冒号后面的值，只保留列名
          const colonIdx = cleanPart.indexOf("：");
          const semicIdx = cleanPart.indexOf(":");
          const cutIdx = colonIdx >= 0 ? colonIdx : semicIdx >= 0 ? semicIdx : -1;
          const namePart = cutIdx >= 0 ? cleanPart.substring(0, cutIdx).trim() : cleanPart.trim();
          if (namePart.includes(keyword) && namePart.length <= 30 && namePart.length >= 1) {
            candidates.push(namePart);
          }
        }
      }

      if (candidates.length === 0) continue;
      if (candidates.length === 1) return candidates[0];

      // 多个候选：优先返回 SKU 相关的列名
      // SKU 相关关键词：SKU、物品、商品、产品
      // 非 SKU 关键词：仓库、货主、库存、在库、可用、冻结、分配、下单
      const skuRelevant = ["SKU", "物品", "商品", "产品", "条码", "发货", "出库", "数量"];
      const skuIrrelevant = ["仓库", "货主", "库存", "在库", "可用", "冻结", "分配", "下单", "结余", "待移"];

      for (const candidate of candidates) {
        if (skuRelevant.some((kw) => candidate.includes(kw))) {
          return candidate;
        }
      }
      // 没有明显 SKU 相关的，返回第一个非无关的
      for (const candidate of candidates) {
        if (!skuIrrelevant.some((kw) => candidate.includes(kw))) {
          return candidate;
        }
      }
      // 全是不相关的，返回第一个
      return candidates[0];
    }
  }
  // 如果没有分隔符但包含关键词，直接返回整行清理后的结果
  const cleaned = lineText.replace(/^行\d+:\s*/, "").trim();
  if (cleaned.includes(keyword)) {
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
    const rowKey = (m.rowKeyPattern as string) || null;
    const mode = (m.mode as string) || "column_name";

    // suggestedSource 优先显示 rowKeyPattern（如果是 row_field 模式），否则显示 columnName
    const suggestedSource = (mode === "row_field" && rowKey)
      ? `关键字: "${rowKey}"`
      : colName
        || (colIdx !== null ? `第${colIdx + 1}列` : "")
        || (rowKey ? `关键字: "${rowKey}"` : "")
        || (staticVal ? `${staticVal}` : "");

    fieldMappings.push({
      targetField: (m.targetField as string) || "",
      suggestedSource,
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

    // 矩阵模式下：externalCode 强制留空（防御：AI 偶尔会填文件名/随便猜，这里兜底清空）
    let staticVal = m.staticValue as string | undefined;
    let defaultVal = m.defaultValue as string | undefined;
    if (isAIResultMatrixMode && targetField === "externalCode") {
      staticVal = "";
      defaultVal = "";
    }

    return {
      targetField,
      mode,
      columnIndex: m.columnIndex as number | undefined,
      columnName: (m.columnName as string) || undefined,
      regexPattern: m.regexPattern as string | undefined,
      regexGroup: m.regexGroup as number | undefined,
      rowKeyPattern: m.rowKeyPattern as string | undefined,
      staticValue: staticVal,
      defaultValue: defaultVal,
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
