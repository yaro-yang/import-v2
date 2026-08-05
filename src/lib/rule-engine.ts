// 规则引擎 - 核心解析逻辑 V2
// 支持：头部跳过、尾部提取、跨行聚合、矩阵转置、卡片拆分、复合单元格、多Sheet合并、合计行跳过
// 支持：Word/PDF 纯文本解析、文本记录拆分、正则提取

import { ParseRule, FieldMapping, OrderItem, ValidationError } from "@/types";
import { v4 as uuidv4 } from "uuid";

interface RawDataRow {
  rowIndex: number;
  cells: Record<string, string>;
  sourceSheet?: string;
  tailFields?: Record<string, string>;
  // headerName → colIdx 反向映射（避免在 cells 里混入对象污染 Object.values 遍历）
  headerColIdx?: Record<string, number>;
}

// ====== 矩阵模式自动检测（executeRule 入口处使用） ======

const MATRIX_STANDARD_KEYWORDS = [
  "编码", "名称", "数量", "规格", "单位", "SKU", "条码", "库存", "状态", "备注", "序号", "分类",
  "品牌", "仓库", "日期", "货主", "商品", "分配", "结余", "在库", "可用", "待移", "移入", "冻结",
  "单品", "价格", "金额", "总价",
];
const MATRIX_STORE_PATTERNS = ["店", "门店", "分店", "商场", "银泰", "金桥", "金银潭", "万象", "万达", "广场", "世纪"];

function isStandardHeader(name: string): boolean {
  return MATRIX_STANDARD_KEYWORDS.some((kw) => name.includes(kw));
}

function isLikelyStoreColumnName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (isStandardHeader(trimmed)) return false;
  return MATRIX_STORE_PATTERNS.some((kw) => trimmed.includes(kw));
}

/**
 * 自动检测矩阵布局：
 * - 取首行作为表头，识别其中所有非标准字段的"门店列"
 * - 至少需要识别到 2 个门店列
 * - 数据中前 30 行内不能出现"调拨单号/收货人/电话/地址"等单据/收件人关键词
 * 返回 { headerRow, storeColumnNames } 或 null
 */
function autoDetectMatrixMode(rawData: RawDataRow[]): { headerRow: number; storeColumnNames: string[] } | null {
  if (rawData.length === 0) return null;
  const firstRow = rawData[0];
  const namedKeys = Object.keys(firstRow.cells).filter(
    (k) => !k.startsWith("col_") && !k.startsWith("_transposed")
  );
  if (namedKeys.length === 0) return null;

  const storeColumns = namedKeys.filter(isLikelyStoreColumnName);
  if (storeColumns.length < 2) return null;

  // 确认不是卡片/标准单据布局
  const allText = rawData.slice(0, 30).map((r) => Object.values(r.cells).join(" ")).join("\n");
  const docLikeKeywords = ["调拨单号", "配送单号", "单据号", "订单号", "运单号", "收货人", "收件人", "联系电话", "收货地址", "收货门店"];
  if (docLikeKeywords.some((kw) => allText.includes(kw))) return null;

  return { headerRow: 0, storeColumnNames: storeColumns };
}

/**
 * 自动启用 matrixMode 时，确保 fieldMappings 里有 storeName/skuQuantity 的 matrix_transpose 映射，
 * 以及 externalCode 的 static_value="" 映射。
 * 已存在的映射不会被覆盖。
 */
function ensureMatrixFieldMappings(mappings: FieldMapping[], storeColumnNames: string[]): FieldMapping[] {
  const result = [...mappings];
  const has = (tf: string) => result.some((m) => m.targetField === tf);

  if (!has("storeName")) {
    result.push({
      targetField: "storeName",
      mode: "matrix_transpose",
      columnName: `矩阵门店列(${storeColumnNames.join("/")})`,
    });
  }
  if (!has("skuQuantity")) {
    result.push({
      targetField: "skuQuantity",
      mode: "matrix_transpose",
      columnName: "矩阵门店列值(转置后自动填充)",
    });
  }
  if (!has("externalCode")) {
    result.push({
      targetField: "externalCode",
      mode: "static_value",
      staticValue: "",
      defaultValue: "",
    });
  }
  return result;
}

// ====== 主入口 ======

export type ProgressCallback = (
  processed: number,
  total: number,
  message?: string
) => void;

export async function executeRule(
  rawData: RawDataRow[],
  rule: ParseRule,
  fileName: string,
  onProgress?: ProgressCallback
): Promise<{ orders: OrderItem[]; errors: ValidationError[] }> {
  // 自动检测：如果是卡片式文件（内容含 ▶ 标记），强制启用 cardMode
  if (!rule.dataRegion.cardMode?.enabled) {
    const allText = rawData.map((r) => Object.values(r.cells).join(" ")).join("\n");
    if (allText.includes("▶") && (allText.includes("调拨记录") || allText.includes("配送记录") || allText.includes("记录"))) {
      console.log(`[executeRule] Auto-detected card-style file, enabling cardMode with marker "▶"`);
      rule = {
        ...rule,
        dataRegion: {
          ...rule.dataRegion,
          cardMode: { enabled: true, startMarker: "▶" },
        },
      };
    }
  }

  // 自动检测：如果是矩阵分配表（表头含≥2个门店列、且无外部单号/收件人字段），强制启用 matrixMode
  // 这是对已保存规则的兜底——即使旧规则没有 matrixMode，只要数据本身是矩阵布局就转置
  if (!rule.dataRegion.matrixMode?.enabled) {
    const autoMatrix = autoDetectMatrixMode(rawData);
    if (autoMatrix) {
      console.log(`[executeRule] Auto-detected matrix layout (${autoMatrix.storeColumnNames.length} store columns), enabling matrixMode`);
      rule = {
        ...rule,
        dataRegion: {
          ...rule.dataRegion,
          matrixMode: {
            enabled: true,
            valueColumnNamesRow: autoMatrix.headerRow,
            storeColumnNames: autoMatrix.storeColumnNames,
          },
        },
        fieldMappings: ensureMatrixFieldMappings(rule.fieldMappings, autoMatrix.storeColumnNames),
      };
    }
  }
  const startTime = performance.now();
  const orders: OrderItem[] = [];
  const errors: ValidationError[] = [];
  const total = rawData.length;
  // 初始进度
  onProgress?.(0, total, "开始解析...");

  // 0. 文本记录拆分（Word/PDF 纯文本模式）
  if (rule.postProcessing?.textRecordMarker) {
    const textSections = splitByTextMarker(rawData, rule);
    onProgress?.(0, textSections.length, `识别到 ${textSections.length} 个文本段`);
    for (let i = 0; i < textSections.length; i++) {
      const section = textSections[i];
      const sectionOrders = buildOrderFromTextSection(section, rule, fileName);
      for (const order of sectionOrders) {
        const errs = validateOrder(order);
        if (errs.length > 0) { order.errors = errs; order.status = "error"; errors.push(...errs); }
        orders.push(order);
      }
      onProgress?.(i + 1, textSections.length, `已处理 ${i + 1}/${textSections.length} 段`);
    }
  }
  // 1. 卡片模式处理
  else if (rule.dataRegion.cardMode?.enabled) {
    const { groups: cardGroups, preCardRows } = splitByCards(rawData, rule);
    onProgress?.(0, cardGroups.length, `识别到 ${cardGroups.length} 个卡片`);
    // 从第一个标记前的行中提取订单级字段（如 externalCode）
    const orderLevelFields = extractOrderLevelFields(preCardRows);
    for (let i = 0; i < cardGroups.length; i++) {
      const group = cardGroups[i];
      const cardOrders = buildOrderFromCard(group, rule, fileName);
      // 合并订单级字段（如未在卡片中提取到）
      for (const order of cardOrders) {
        for (const [k, v] of Object.entries(orderLevelFields)) {
          const current = (order as unknown as Record<string, unknown>)[k];
          if (!current) (order as unknown as Record<string, unknown>)[k] = v;
        }
        const errs = validateOrder(order);
        if (errs.length > 0) { order.errors = errs; order.status = "error"; errors.push(...errs); }
        orders.push(order);
      }
      onProgress?.(i + 1, cardGroups.length, `已处理 ${i + 1}/${cardGroups.length} 张卡片`);
    }
  }
  // 2. 复合单元格拆分
  else if (rule.dataRegion.compositeMode?.enabled) {
    const expandedRows = expandCompositeCells(rawData, rule);
    processRows(expandedRows, rule, fileName, orders, errors, total, onProgress);
  }
  // 3. 矩阵转置
  else if (rule.dataRegion.matrixMode?.enabled) {
    const transposedRows = transposeMatrix(rawData, rule);
    processRows(transposedRows, rule, fileName, orders, errors, total, onProgress);
  }
  // 4. 标准处理
  else {
    processRows(rawData, rule, fileName, orders, errors, total, onProgress);
  }

  const endTime = performance.now();
  onProgress?.(total, total, `解析完成，共 ${orders.length} 条`);
  console.log(`Rule execution completed in ${(endTime - startTime).toFixed(2)}ms, orders: ${orders.length}`);
  return { orders, errors };
}

// ====== 文本记录拆分（Word/PDF） ======
function splitByTextMarker(rawData: RawDataRow[], rule: ParseRule): string[][] {
  const marker = rule.postProcessing?.textRecordMarker || "---PAGE_BREAK---";
  const sections: string[][] = [];
  let currentSection: string[] = [];

  for (const row of rawData) {
    const text = row.cells["text"] || row.cells["col_0"] || "";
    if (text.includes(marker)) {
      if (currentSection.length > 0) sections.push(currentSection);
      currentSection = [];
    } else {
      currentSection.push(text);
    }
  }
  if (currentSection.length > 0) sections.push(currentSection);
  return sections.length > 0 ? sections : [rawData.map((r) => r.cells["text"] || r.cells["col_0"] || "")];
}

// ====== 从文本段构建运单（Word/PDF 纯文本模式） ======
// 返回多个 OrderItem（每个 SKU 一条），共享父单字段
function buildOrderFromTextSection(
  textLines: string[],
  rule: ParseRule,
  fileName: string
): OrderItem[] {
  const fullText = textLines.join("\n");
  if (!fullText.trim()) return [];

  const baseOrder: OrderItem = {
    id: uuidv4(),
    skuCode: "", skuName: "", skuQuantity: 0,
    status: "draft",
    sourceFile: fileName,
    sourceRow: 0,
    ruleId: rule.id,
    createdAt: new Date().toISOString(),
  };

  // 使用字段映射中的正则/行模式提取
  for (const mapping of rule.fieldMappings) {
    let value = "";

    if (mapping.mode === "regex_extract" && mapping.regexPattern) {
      const match = fullText.match(new RegExp(mapping.regexPattern, "s"));
      value = match ? (match[mapping.regexGroup || 1] || match[0]) : "";
    } else if (mapping.mode === "row_field" && mapping.rowKeyPattern) {
      for (const line of textLines) {
        if (line.includes(mapping.rowKeyPattern)) {
          const match = line.match(new RegExp(`${mapping.rowKeyPattern}[：:]*\\s*(.+)`));
          if (match) { value = match[1].trim(); break; }
        }
      }
    } else if (mapping.mode === "column_name") {
      // 尝试文本行匹配
      for (const line of textLines) {
        if (line.includes(mapping.columnName || "")) {
          const match = line.match(new RegExp(`${mapping.columnName}[：:]*\\s*(.+)`));
          if (match) { value = match[1].trim(); break; }
        }
      }
    } else if (mapping.staticValue) {
      value = mapping.staticValue;
    }

    if (value) {
      if (mapping.targetField === "skuQuantity") {
        baseOrder.skuQuantity = parseFloat(value) || 0;
      } else {
        setOrderField(baseOrder, mapping.targetField, value);
      }
    }
  }

  // 特殊处理：从物品行提取 SKU 信息（格式：编号 类别 编码 名称 规格 单位 数量）
  const skuLines: { code: string; name: string; spec: string; qty: number }[] = [];
  for (const line of textLines) {
    // 匹配物品行：数字开头 + 至少3个字段
    const skuMatch = line.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s+(\S+)\s+\S+\s+(\d+)/);
    if (skuMatch) {
      skuLines.push({
        code: skuMatch[3],
        name: skuMatch[4].trim(),
        spec: skuMatch[5],
        qty: parseInt(skuMatch[6]) || 0,
      });
    }
  }

  // 每个 SKU 一条 OrderItem（共享父单字段）
  if (skuLines.length > 0) {
    return skuLines.map((sku) => ({
      ...baseOrder,
      id: uuidv4(),
      skuCode: sku.code,
      skuName: sku.name,
      skuQuantity: sku.qty,
      skuSpec: sku.spec,
    }));
  }

  // 没有识别到 SKU 行：返回一条占位记录
  return [baseOrder];
}

// ====== 从卡片构建运单 ======
// 返回多个 OrderItem（每个 SKU 一条），共享父单字段
function buildOrderFromCard(
  cardRows: RawDataRow[],
  rule: ParseRule,
  fileName: string
): OrderItem[] {
  if (cardRows.length === 0) return [];

  // 父单基础信息（每个 SKU 行共享这些字段）
  const baseOrder: OrderItem = {
    id: uuidv4(),
    skuCode: "", skuName: "", skuQuantity: 0,
    status: "draft",
    sourceFile: fileName,
    sourceRow: cardRows[0].rowIndex,
    ruleId: rule.id,
    createdAt: new Date().toISOString(),
  };

  // 卡片头部常见字段的默认关键词
  const cardHeaderDefaults: Record<string, string[]> = {
    storeName: ["调入门店", "收货门店", "门店", "收货机构", "客户名称", "店铺名称"],
    recipientName: ["收货人", "联系人", "收件人", "收件人姓名", "收货人姓名"],
    recipientPhone: ["电话", "联系电话", "手机", "收货电话", "手机号"],
    recipientAddress: ["收货地址", "地址", "收件人地址", "详细地址"],
    externalCode: ["调拨单号", "配送单号", "单据号", "外部编码", "运单号"],
    remark: ["备注", "说明", "附注"],
  };

  // 在卡片所有行中查找 "标签|值" 或 "标签：值" 形式
  // 只用 col_N 键取单元格值，避免表头名与列索引重复
  const getCardCells = (row: RawDataRow): string[] => {
    return Object.entries(row.cells)
      .filter(([k]) => k.startsWith("col_"))
      .sort((a, b) => parseInt(a[0].slice(4)) - parseInt(b[0].slice(4)))
      .map(([, v]) => (v || "").trim());
  };

  const extractFromCardHeader = (keywords: string[]): string => {
    for (const row of cardRows) {
      const cells = getCardCells(row);
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i] || "";
        for (const kw of keywords) {
          // 单元格本身就是标签（如 "调入门店"），取下一个非空单元格
          if (cell === kw) {
            for (let j = i + 1; j < cells.length; j++) {
              const v = (cells[j] || "").trim();
              if (v && v !== "·" && v !== "-") return v;
            }
          }
          // 单元格本身包含 "标签|值" 或 "标签：值" - 提取第一个分隔符后的值
          if (cell.includes(kw)) {
            const kwIdx = cell.indexOf(kw);
            const after = cell.substring(kwIdx + kw.length);
            // 支持多种分隔符：| ｜ ： : = → （空格分隔）
            const sepMatch = after.match(/^\s*[|｜：:=→\s]\s*(.+?)(?:\s*[|｜]|$)/);
            if (sepMatch) {
              const v = sepMatch[1].trim();
              if (v && v !== "·" && v !== "-") return v;
            }
            // 如果分隔符匹配失败，但 after 非空且不含分隔符（如 "编码*"），说明只是后缀标记
            // 此时不提取值，继续在相邻单元格找
          }
        }
      }
    }
    return "";
  };

  // 提取卡片头部信息（收货门店、收货人等）
  for (const mapping of rule.fieldMappings) {
    if (["storeName", "recipientName", "recipientPhone", "recipientAddress", "externalCode", "remark"].includes(mapping.targetField)) {
      let value = "";
      // 优先按用户配置的 rowKeyPattern 提取
      if (mapping.mode === "row_field" && mapping.rowKeyPattern) {
        value = extractFromCardHeader([mapping.rowKeyPattern]);
      }
      // 兜底：用字段的默认关键词自动提取（适用于未配置 rowKeyPattern 的旧规则）
      if (!value) {
        const defaults = cardHeaderDefaults[mapping.targetField] || [];
        value = extractFromCardHeader(defaults);
      }
      // 再尝试 column_name 等普通模式
      if (!value) {
        value = extractFieldValue(cardRows[0], mapping);
      }
      // 最后兜底：全文正则扫描，匹配 "关键词：值" 或 "关键词|值" 格式
      if (!value) {
        const defaults = cardHeaderDefaults[mapping.targetField] || [];
        for (const kw of defaults) {
          for (const row of cardRows) {
            const cellsText = Object.values(row.cells).join(" | ");
            const match = cellsText.match(new RegExp(`${kw}\\s*[：:|｜]\\s*(.+?)(?:\\s*[|｜]|$)`, "i"));
            if (match) {
              const v = match[1].trim();
              if (v && v !== "·" && v !== "-" && v !== kw) {
                value = v;
                break;
              }
            }
          }
          if (value) break;
        }
      }
      if (value) setOrderField(baseOrder, mapping.targetField, value);
    }
  }

  // 提取 SKU 数据（卡片内的小表）
  // 先收集所有已知的卡片头部 label 关键词，用于识别 key-value 配对行
  const labelKeywords = new Set<string>();
  for (const kws of Object.values(cardHeaderDefaults)) {
    for (const kw of kws) labelKeywords.add(kw);
  }
  // 通用 SKU 表头 / 标记
  ["物品编码", "物品名称", "规格", "数量", "SKU编码", "SKU名称", "SKU数量"].forEach((s) => labelKeywords.add(s));

  // 检测卡片内的 SKU 表头行，建立"列名 → col_N"映射
  // 优先级：规则配置 > 通用 SKU 关键词
  const skuHeaderMap: Record<string, number> = {};
  const skuHeaderKeywords: Record<string, string[]> = {
    skuCode: ["物品编码", "SKU编码", "商品编码", "产品编码", "编码"],
    skuName: ["物品名称", "SKU名称", "商品名称", "产品名称", "品名", "名称"],
    skuSpec: ["规格型号", "规格", "型号"],
    skuQuantity: ["发货数量", "数量", "件数", "SKU数量", "订货数量"],
  };
  for (const row of cardRows) {
    const cells = getCardCells(row);
    if (cells.length === 0) continue;
    // 检查这一行是否是 SKU 表头行（包含多个 SKU 字段关键词）
    const hits: Record<string, number> = {};
    for (let i = 0; i < cells.length; i++) {
      const cell = (cells[i] || "").trim();
      for (const [field, kws] of Object.entries(skuHeaderKeywords)) {
        if (kws.some((kw) => cell === kw || cell.includes(kw))) {
          hits[field] = i;
          break;
        }
      }
    }
    if (Object.keys(hits).length >= 2) {
      Object.assign(skuHeaderMap, hits);
      break; // 找到表头就退出
    }
  }

  // 收集每条 SKU 行（不聚合），保留单条记录
  const skuRows: { code: string; name: string; spec: string; qty: number; sourceRow: number }[] = [];

  for (const row of cardRows) {
    const cells = getCardCells(row);
    if (cells.length === 0) continue;
    const firstCell = (cells[0] || "").trim();
    // 跳过 key-value 配对行（col_0 是 label）和 SKU 表头 / 卡片标记
    if (!firstCell || labelKeywords.has(firstCell) || firstCell.includes("▶")) continue;

    const skuCodeMapping = rule.fieldMappings.find((m) => m.targetField === "skuCode");
    const skuNameMapping = rule.fieldMappings.find((m) => m.targetField === "skuName");
    const skuQtyMapping = rule.fieldMappings.find((m) => m.targetField === "skuQuantity");
    const skuSpecMapping = rule.fieldMappings.find((m) => m.targetField === "skuSpec");

    // 三段式提取：①规则配置 → ②卡片内检测的 SKU 表头位置 → ③col_N 兜底
    const code =
      extractFieldValue(row, skuCodeMapping) ||
      (skuHeaderMap.skuCode !== undefined ? cells[skuHeaderMap.skuCode] || "" : "") ||
      cells[0] || "";
    const name =
      extractFieldValue(row, skuNameMapping) ||
      (skuHeaderMap.skuName !== undefined ? cells[skuHeaderMap.skuName] || "" : "") ||
      cells[1] || "";
    const qtyStr =
      extractFieldValue(row, skuQtyMapping) ||
      (skuHeaderMap.skuQuantity !== undefined ? cells[skuHeaderMap.skuQuantity] || "" : "") ||
      cells[3] || "";
    const qty = parseFloat(qtyStr) || 0;
    const spec =
      extractFieldValue(row, skuSpecMapping) ||
      (skuHeaderMap.skuSpec !== undefined ? cells[skuHeaderMap.skuSpec] || "" : "") ||
      cells[2] || "";

    // 只有 col_0 看起来像 SKU 编码（字母数字混合，不是中文）才接受
    const isLikelySku = /^[A-Z0-9][A-Z0-9\-_]*$/i.test(code);
    if (!isLikelySku) continue;
    if (!code) continue;

    skuRows.push({ code, name, spec, qty, sourceRow: row.rowIndex });
  }

  // 每个 SKU 一条 OrderItem（共享父单字段）
  if (skuRows.length > 0) {
    return skuRows.map((sku) => ({
      ...baseOrder,
      id: uuidv4(),
      skuCode: sku.code,
      skuName: sku.name,
      skuQuantity: sku.qty,
      skuSpec: sku.spec,
      sourceRow: sku.sourceRow,
    }));
  }

  // 没有识别到 SKU 行：返回一条占位记录（让父单字段仍有展示）
  return [baseOrder];
}

function processRows(
  rawData: RawDataRow[],
  rule: ParseRule,
  fileName: string,
  orders: OrderItem[],
  errors: ValidationError[],
  total: number = rawData.length,
  onProgress?: ProgressCallback
) {
  // 跳过合计行
  // 关键：合计行识别是数据正确性的基础，不该依赖配置。
  // 无论 rule.postProcessing?.skipTotalRow 是什么值，**始终**过滤含"合计"/"小计"/"总计"等行——
  // 这是数据正确性硬保证，避免 AI 没设 skipTotalRow=true 时把合计行当数据行（数量=30等假数据）。
  // 之前用 `if (rule.postProcessing?.skipTotalRow)` 判断，导致 AI 漏设时合计行被错误保留为数据。
  const TOTAL_ROW_PATTERNS = ["合计", "小计", "总计", "合 计"];
  const configuredPattern = rule.postProcessing?.totalRowPattern || "合计";
  const filteredData = rawData.filter((row) => {
    const rowText = Object.values(row.cells).join(" ");
    // 命中配置的 pattern 或常见合计行特征
    if (rowText.includes(configuredPattern)) return false;
    for (const p of TOTAL_ROW_PATTERNS) {
      if (rowText.includes(p)) return false;
    }
    // 启发式：首列（"序号"列对应的值）是"合计"或"小计"等
    const firstCol = row.cells["col_0"] || row.cells["序号"] || "";
    if (typeof firstCol === "string" && TOTAL_ROW_PATTERNS.includes(firstCol.trim())) return false;
    return true;
  });

  // 按外部编码聚合（同一 externalCode 的多行 → 共享收货信息，每行一个 SKU）
  // transfer 模式（调拨单）：每行一个独立 OrderItem，各自保留门店/收件人/地址信息
  // 落库时由 db.ts 按 (externalCode+storeName) 聚合为多个调拨明细
  const mode = rule.globalConfig.mode || "outbound";
  if (mode === "transfer") {
    // 调拨单模式：每行独立处理，不做"按 externalCode 共享收货信息"的合并
    for (let i = 0; i < filteredData.length; i++) {
      const row = filteredData[i];
      const order = buildOrderFromRow(row, rule, fileName);
      if (order) {
        const errs = validateOrder(order);
        if (errs.length > 0) { order.errors = errs; order.status = "error"; errors.push(...errs); }
        orders.push(order);
      }
      onProgress?.(i + 1, total, `已处理 ${i + 1}/${total} 行`);
    }
  } else if (rule.globalConfig.groupByExternalCode && rule.globalConfig.externalCodeField) {
    const grouped = groupByExternalCode(filteredData, rule);
    const groups = Array.from(grouped.entries());
    onProgress?.(0, groups.length, `识别到 ${groups.length} 个外部编码`);
    for (let i = 0; i < groups.length; i++) {
      const [code, rows] = groups[i];
      const groupOrders = buildOrderFromRows(rows, rule, fileName, code);
      for (const order of groupOrders) {
        const errs = validateOrder(order);
        if (errs.length > 0) { order.errors = errs; order.status = "error"; errors.push(...errs); }
        orders.push(order);
      }
      onProgress?.(i + 1, groups.length, `已处理 ${i + 1}/${groups.length} 个外部编码`);
    }
  } else {
    for (let i = 0; i < filteredData.length; i++) {
      const row = filteredData[i];
      const order = buildOrderFromRow(row, rule, fileName);
      if (order) {
        const errs = validateOrder(order);
        if (errs.length > 0) { order.errors = errs; order.status = "error"; errors.push(...errs); }
        orders.push(order);
      }
      // 每处理 1 行回调一次（避免大文件回调过频）
      onProgress?.(i + 1, total, `已处理 ${i + 1}/${total} 行`);
    }
  }
}

// ====== 卡片拆分 ======
function splitByCards(
  rawData: RawDataRow[],
  rule: ParseRule
): { groups: RawDataRow[][]; preCardRows: RawDataRow[] } {
  const groups: RawDataRow[][] = [];
  const preCardRows: RawDataRow[] = [];
  let currentGroup: RawDataRow[] = [];
  const marker = rule.dataRegion.cardMode?.startMarker || "";
  let foundFirstMarker = false;

  for (const row of rawData) {
    const rowText = Object.values(row.cells).join(" ");
    if (rowText.includes(marker)) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [row];
      foundFirstMarker = true;
    } else if (foundFirstMarker) {
      currentGroup.push(row);
    } else {
      // 标记前的行（如标题、订单头）单独收集，用于提取订单级字段
      preCardRows.push(row);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);
  return { groups, preCardRows };
}

// ====== 从订单头中提取订单级字段（如 externalCode） ======
function extractOrderLevelFields(preCardRows: RawDataRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (preCardRows.length === 0) return result;

  // 合并所有行的文本
  const combinedText = preCardRows
    .map((r) => Object.values(r.cells).filter((v) => v && v.trim()).join(" "))
    .join("\n");

  // 字段关键词 → 订单字段映射
  const fieldMap: Array<{ keywords: string[]; target: string }> = [
    { keywords: ["调拨单号", "配送单号", "单据号", "外部编码", "运单号", "订单号"], target: "externalCode" },
    { keywords: ["调出仓库", "仓库", "出货仓"], target: "warehouse" },
    { keywords: ["调拨日期", "配送日期", "日期"], target: "transferDate" },
    { keywords: ["经办人", "制单人", "操作人"], target: "operator" },
  ];

  // 用 | 或 ｜ 或 换行 分段
  const segments = combinedText.split(/[|｜\n]/);
  for (const seg of segments) {
    const m = seg.match(/^\s*([^：:]+?)\s*[：:]\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2].trim();
    for (const fm of fieldMap) {
      if (fm.keywords.some((kw) => key.includes(kw))) {
        if (!result[fm.target]) result[fm.target] = value;
        break;
      }
    }
  }
  return result;
}

// ====== 复合单元格拆分 ======
function expandCompositeCells(rawData: RawDataRow[], rule: ParseRule): RawDataRow[] {
  const expanded: RawDataRow[] = [];
  const mode = rule.dataRegion.compositeMode;
  if (!mode) return rawData;

  const separator = mode.separator || "\n";
  const pattern = mode.pattern || "(.+?)x(\\d+)";

  for (const row of rawData) {
    // 检查哪些单元格需要拆分
    let hasComposite = false;
    const compositeValues: { colKey: string; items: { name: string; qty: number }[] }[] = [];

    for (const [key, value] of Object.entries(row.cells)) {
      if (value.includes(separator)) {
        const parts = value.split(separator).filter((p) => p.trim());
        const items: { name: string; qty: number }[] = [];
        for (const part of parts) {
          const match = part.match(new RegExp(pattern));
          if (match) {
            items.push({ name: match[1].trim(), qty: parseInt(match[2]) || 1 });
            hasComposite = true;
          }
        }
        if (items.length > 0) compositeValues.push({ colKey: key, items });
      }
    }

    if (hasComposite) {
      // 展开为多行
      const maxItems = Math.max(...compositeValues.map((c) => c.items.length));
      for (let i = 0; i < maxItems; i++) {
        const newRow: RawDataRow = {
          ...row,
          rowIndex: row.rowIndex * 1000 + i,
          cells: { ...row.cells },
          tailFields: row.tailFields ? { ...row.tailFields } : undefined,
        };
        for (const cv of compositeValues) {
          if (i < cv.items.length) {
            newRow.cells[cv.colKey] = cv.items[i].name;
            newRow.cells["_qty_" + cv.colKey] = String(cv.items[i].qty);
          } else {
            newRow.cells[cv.colKey] = "";
          }
        }
        expanded.push(newRow);
      }
    } else {
      expanded.push(row);
    }
  }
  return expanded;
}

// ====== 矩阵转置 ======
function transposeMatrix(rawData: RawDataRow[], rule: ParseRule): RawDataRow[] {
  const mode = rule.dataRegion.matrixMode;
  if (!mode) return rawData;
  if (rawData.length === 0) return [];

  // ===== 第一步：确定门店列名和索引 =====
  const storeNames: string[] = mode.storeColumnNames || [];
  const storeIndices: number[] = mode.storeColumnIndices || [];

  // 收件人/订单级字段名（绝不应该被当成门店列）—— 防止旧规则误配
  const recipientColumnPatterns = [
    "收货人", "收件人", "联系人", "收货电话", "收件人电话", "联系电话", "电话", "手机",
    "收货地址", "收件人地址", "收货机构", "收货门店", "门店名称", "门店编号",
    "调拨单号", "配送单号", "单据号", "订单号", "运单号", "配送汇总单号", "单号",
    "经办人", "制单人", "操作人", "司机", "车牌",
  ];

  // 如果配置中的"门店列名"实际是收件人/订单级字段，全部过滤掉（视为无有效矩阵配置）
  const validStoreNames = storeNames.filter(
    (n) => !recipientColumnPatterns.some((p) => n.includes(p))
  );
  if (validStoreNames.length === 0 && storeNames.length > 0) {
    console.warn(
      `[transposeMatrix] 配置的 storeColumnNames 全部为收件人/订单级字段 (${storeNames.join("/")})，已全部过滤。规则可能配置错误。`
    );
    return rawData; // 回退到标准处理
  }
  storeNames.length = 0;
  storeNames.push(...validStoreNames);

  // 如果配置中已有有效的索引和名称，直接使用
  const hasValidConfig = storeIndices.length > 0 && storeNames.length === storeIndices.length;

  if (!hasValidConfig) {
    // 兜底：用 row.headerColIdx 反向表（headerName → colIdx）查索引
    // 这是 excelToRawData 阶段显式保存的映射，**避免"按值匹配"在空值场景不可靠的问题**
    // （如"银泰"列首行值是空字符串时，cells[col_7]=cells[col_13]=""，值匹配会把所有空值列都匹配上）
    // 注意：必须从 row.headerColIdx 读，**不要**塞到 row.cells 里——后者会被 Object.values 遍历污染
    const firstDataRow = rawData[0];
    if (!firstDataRow) return rawData;
    const headerColIdx = firstDataRow.headerColIdx || {};

    const newStoreIndices: number[] = [];
    const newStoreNames: string[] = [];
    for (const name of storeNames) {
      // 1) 直接匹配
      let idx = headerColIdx[name];
      // 2) 包含匹配（在 headerColIdx keys 中）
      if (idx === undefined) {
        for (const [hk, hi] of Object.entries(headerColIdx)) {
          if (hk === name || hk.includes(name) || name.includes(hk)) {
            idx = hi;
            break;
          }
        }
      }
      if (idx !== undefined && !newStoreIndices.includes(idx)) {
        newStoreIndices.push(idx);
        newStoreNames.push(name);
      }
    }
    // 同步写回 storeNames/storeIndices
    storeNames.length = 0;
    storeNames.push(...newStoreNames);
    storeIndices.length = 0;
    storeIndices.push(...newStoreIndices);

    if (storeIndices.length === 0) {
      // 最后兜底：扫描所有 headerColIdx keys，把"非标准字段"全当门店列
      const standardKeywords = [
        "编码", "名称", "数量", "规格", "单位", "SKU", "条码", "库存", "状态", "备注", "序号", "分类",
        "品牌", "仓库", "日期", "货主", "商品", "分配", "结余", "在库", "可用", "待移", "移入", "冻结",
        "单品", "价格", "金额", "总价",
      ];
      const isStandard = (n: string) => standardKeywords.some((kw) => n.includes(kw));
      for (const [hk, hi] of Object.entries(headerColIdx)) {
        if (hk && !isStandard(hk) && hk.length <= 30) {
          if (!storeNames.includes(hk)) storeNames.push(hk);
          if (!storeIndices.includes(hi)) storeIndices.push(hi);
        }
      }
    }
  }

  // ===== 第二步：转置 =====
  const transposed: RawDataRow[] = [];
  const len = Math.min(storeNames.length, storeIndices.length);

  for (const row of rawData) {
    for (let i = 0; i < len; i++) {
      const colIdx = storeIndices[i];
      const colName = storeNames[i];
      const cellValue = row.cells[`col_${colIdx}`];
      // 跳过空值或0
      if (!cellValue || cellValue.trim() === "" || cellValue === "0" || cellValue === "null") continue;

      transposed.push({
        rowIndex: row.rowIndex * 1000 + colIdx,
        cells: {
          ...row.cells,
          "_transposed_col_name": colName,
          "_transposed_value": cellValue,
        },
        tailFields: row.tailFields,
      });
    }
  }

  return transposed;
}

// ====== 按外部编码分组 ======
function groupByExternalCode(rows: RawDataRow[], rule: ParseRule): Map<string, RawDataRow[]> {
  const grouped = new Map<string, RawDataRow[]>();
  const codeField = rule.globalConfig.externalCodeField || "externalCode";
  const codeMapping = rule.fieldMappings.find((m) => m.targetField === codeField);

  for (const row of rows) {
    const code = extractFieldValue(row, codeMapping) || "__no_code__";
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code)!.push(row);
  }
  return grouped;
}

// ====== 从多行构建运单 ======
// 返回多个 OrderItem（每个 SKU 行一条），共享父单收货信息
function buildOrderFromRows(
  rows: RawDataRow[],
  rule: ParseRule,
  fileName: string,
  externalCode: string
): OrderItem[] {
  if (rows.length === 0) return [];
  const firstRow = rows[0];
  // 父单基础字段：所有 SKU 行共享这些
  const baseOrder: OrderItem = {
    id: uuidv4(),
    externalCode: externalCode !== "__no_code__" ? externalCode : undefined,
    skuCode: "", skuName: "", skuQuantity: 0,
    status: "draft",
    sourceFile: fileName,
    sourceSheet: firstRow.sourceSheet,
    sourceRow: firstRow.rowIndex,
    ruleId: rule.id,
    createdAt: new Date().toISOString(),
  };

  // 提取共享收货信息
  for (const mapping of rule.fieldMappings) {
    if (["storeName", "recipientName", "recipientPhone", "recipientAddress", "remark"].includes(mapping.targetField)) {
      let value = extractFieldValue(firstRow, mapping);
      // 矩阵转置模式：门店名来自列名
      if (mapping.targetField === "storeName" && firstRow.cells["_transposed_col_name"]) {
        value = firstRow.cells["_transposed_col_name"];
      }
      if (value) setOrderField(baseOrder, mapping.targetField, value);
    }
  }

  // 每个原始行 = 一个 SKU 行，每行一个 OrderItem
  return rows.map((row) => {
    const skuCode = extractFieldValue(row, rule.fieldMappings.find((m) => m.targetField === "skuCode")) || "";
    const skuName = extractFieldValue(row, rule.fieldMappings.find((m) => m.targetField === "skuName")) || "";
    const skuQty = parseFloat(extractFieldValue(row, rule.fieldMappings.find((m) => m.targetField === "skuQuantity")) || "0") || 0;
    const skuSpec = extractFieldValue(row, rule.fieldMappings.find((m) => m.targetField === "skuSpec")) || "";
    return {
      ...baseOrder,
      id: uuidv4(),
      skuCode,
      skuName,
      skuQuantity: skuQty,
      skuSpec: skuSpec || undefined,
      sourceRow: row.rowIndex,
    };
  });
}

// ====== 从单行构建运单 ======
function buildOrderFromRow(row: RawDataRow, rule: ParseRule, fileName: string): OrderItem | null {
  const order: OrderItem = {
    id: uuidv4(),
    skuCode: "", skuName: "", skuQuantity: 0,
    status: "draft",
    sourceFile: fileName,
    sourceSheet: row.sourceSheet,
    sourceRow: row.rowIndex,
    ruleId: rule.id,
    createdAt: new Date().toISOString(),
  };

  for (const mapping of rule.fieldMappings) {
    let value = extractFieldValue(row, mapping);
    // 矩阵转置模式：门店名和数量来自转置后的特殊键
    if (mapping.targetField === "storeName" && row.cells["_transposed_col_name"]) {
      value = row.cells["_transposed_col_name"];
    }
    if (mapping.targetField === "skuQuantity" && row.cells["_transposed_value"]) {
      value = row.cells["_transposed_value"];
    }
    if (value !== undefined && value !== null && value !== "") {
      if (mapping.targetField === "skuQuantity") {
        order.skuQuantity = parseFloat(value) || 0;
      } else {
        setOrderField(order, mapping.targetField, value);
      }
    }
  }

  // 合并尾部字段
  if (row.tailFields) {
    for (const [key, value] of Object.entries(row.tailFields)) {
      if (value && !getOrderField(order, key)) {
        setOrderField(order, key, value);
      }
    }
  }

  return order;
}

// ====== 字段值提取 ======
function extractFieldValue(row: RawDataRow, mapping?: FieldMapping): string {
  if (!mapping) return "";

  switch (mapping.mode) {
    case "column_index":
      return row.cells[`col_${mapping.columnIndex}`] || "";
    case "column_name": {
      const named = mapping.columnName ? (row.cells[mapping.columnName] || "") : "";
      if (named) return named;

      // 模糊匹配兜底：AI 返回的 columnName 可能不带后缀（如"物品编码"），
      // 但实际表头带后缀（如"物品编码*"），尝试在 cells 的 key 中做包含匹配
      if (mapping.columnName) {
        const fuzzyKey = Object.keys(row.cells).find(
          (k) => k.includes(mapping.columnName!) && !k.startsWith("col_")
        );
        if (fuzzyKey) {
          const fuzzyVal = row.cells[fuzzyKey] || "";
          if (fuzzyVal) return fuzzyVal;
        }
      }

      // 列名查找失败，用列索引兜底
      if (mapping.columnIndex !== undefined) return row.cells[`col_${mapping.columnIndex}`] || "";
      return mapping.defaultValue || "";
    }
    case "static_value":
      return mapping.staticValue || mapping.defaultValue || "";
    case "tail_extract":
      return row.tailFields?.[mapping.targetField] || "";
    case "regex_extract":
      if (mapping.regexPattern) {
        const rowText = Object.values(row.cells).join(" ");
        const match = rowText.match(new RegExp(mapping.regexPattern));
        return match ? (match[mapping.regexGroup || 1] || match[0]) : "";
      }
      return "";
    case "row_field":
      if (mapping.rowKeyPattern) {
        // 1. 先在 row.cells 命名 key 中找 key（按单元格 + 同行下一列的策略）
        for (const [key, value] of Object.entries(row.cells)) {
          if (key.startsWith("col_") || key.startsWith("_transposed")) continue;
          if (String(value ?? "").includes(mapping.rowKeyPattern)) {
            const colKeys = Object.keys(row.cells).filter((k) => k.startsWith("col_")).sort((a, b) => {
              return parseInt(a.slice(4), 10) - parseInt(b.slice(4), 10);
            });
            const matchedColIdx = colKeys.findIndex((k) => String(row.cells[k] ?? "") === String(value ?? ""));
            if (matchedColIdx >= 0) {
              for (let i = matchedColIdx + 1; i < colKeys.length; i++) {
                const v = String(row.cells[colKeys[i]] ?? "").trim();
                if (v) return v;
              }
            }
            return "";
          }
        }
        // 2. 兜底：在 row.tailFields 中找（excelToRawData 提取的 preHeaderFields/tailRegion 字段）
        // tailFields 是 { storeName: "xxx", externalCode: "xxx" } 形式，key 已经是目标字段名
        // 兼容旧规则：也按 rowKeyPattern 的字面文字匹配
        if (row.tailFields) {
          // 直接看是否已经是这个目标字段
          const direct = (row.tailFields as Record<string, string>)[mapping.targetField];
          if (direct) return direct;
        }
        // 3. 从 fullText 兜底（按行扫，看哪一行含 rowKeyPattern）
        // 这种"按行扫"只在 PDF/Word 纯文本场景才需要，已由 preHeaderFields 覆盖大部分情况
        return "";
      }
      return "";
    case "matrix_transpose":
      // 矩阵转置模式：值来自转置后的特殊单元格
      if (mapping.targetField === "storeName") {
        return row.cells["_transposed_col_name"] || "";
      }
      if (mapping.targetField === "skuQuantity") {
        return row.cells["_transposed_value"] || "";
      }
      // 其他字段正常从列中提取
      if (mapping.columnName) return row.cells[mapping.columnName] || "";
      if (mapping.columnIndex !== undefined) return row.cells[`col_${mapping.columnIndex}`] || "";
      return mapping.defaultValue || "";
    default: {
      const named = mapping.columnName ? (row.cells[mapping.columnName] || "") : "";
      if (named) return named;
      if (mapping.columnIndex !== undefined) return row.cells[`col_${mapping.columnIndex}`] || "";
      return mapping.defaultValue || "";
    }
  }
}

// ====== 校验（委托给共享 validation 模块） ======
import { validateOrderItem as _validateOrderItem } from "./validation";

function validateOrder(order: OrderItem): ValidationError[] {
  return _validateOrderItem(order);
}

// ====== Excel 数据转换 ======
export function excelToRawData(
  data: (string | number | null | undefined)[][],
  rule: ParseRule
): RawDataRow[] {
  const rows: RawDataRow[] = [];
  const config = rule.dataRegion;
  let headerRow = config.headerRow ?? 0;
  const skipRows = config.skipRows ?? 0;
  const endRow = config.endRows ?? data.length;

  // ===== headerRow 自我修正 =====
  // 启发式/AI 偶尔会把 headerRow 偏 1 行（第一行被当表头，第二行是数据）
  // 检测当前 headerRow 是否"像表头"：至少要有一个 cell 含中文字段关键词
  const HEADER_HINT_KEYWORDS = [
    "编码", "名称", "数量", "规格", "单位", "SKU", "条码", "店", "门店", "仓库",
    "日期", "价格", "金额", "分类", "品牌", "备注", "序号", "状态", "联系人",
  ];
  const looksLikeHeader = (row: (string | number | null | undefined)[] | undefined): boolean => {
    if (!row || row.length === 0) return false;
    let hints = 0;
    for (const cell of row) {
      const s = String(cell ?? "").trim();
      if (!s) continue;
      if (HEADER_HINT_KEYWORDS.some((kw) => s.includes(kw))) {
        hints++;
        if (hints >= 2) return true;
      }
    }
    return false;
  };
  // 卡片模式下不修正（卡片有 ▶ 标记，headerRow 无意义）
  const isCardModeForHeader = config.cardMode?.enabled === true;
  if (!isCardModeForHeader && data.length > 1) {
    const currentRow = data[headerRow];
    if (!looksLikeHeader(currentRow)) {
      // 在 [headerRow-3, headerRow+3] 范围内找第一个像表头的行
      const searchRange = 3;
      for (let delta = -searchRange; delta <= searchRange; delta++) {
        if (delta === 0) continue;
        const candidate = headerRow + delta;
        if (candidate < 0 || candidate >= data.length) continue;
        if (looksLikeHeader(data[candidate])) {
          console.warn(
            `[excelToRawData] headerRow=${headerRow} 看起来不像表头，自动修正为 ${candidate}`
          );
          headerRow = candidate;
          break;
        }
      }
    }
  }

  // 提取表头
  const headers: string[] = [];
  if (headerRow < data.length) {
    const headerData = data[headerRow];
    if (headerData) {
      for (let col = 0; col < headerData.length; col++) {
        const rawHeader = String(headerData[col] ?? `col_${col}`).trim();
        // 处理合并表头：取最后一行作为实际列名
        const parts = rawHeader.split("\n").filter((p) => p.trim());
        headers.push((parts[parts.length - 1] || rawHeader).trim());
      }
    }
  }

  // 提取数据行
  // 卡片模式下：从第 0 行开始处理（包含标题、订单头、卡片标记），完全忽略 skipRows/headerRow
  // 因为 splitByCards 会按 ▶ 标记拆分，headerRow/skipRows 在卡片模式下无意义
  const isCardMode = config.cardMode?.enabled === true;
  const startRow = isCardMode
    ? 0
    : Math.max(skipRows, headerRow + 1);

  // 尾部/info 行的特征词——含这些词的非空行不当作数据行
  // （这些行的内容是"收货门店：xxx"等键值对，会由 preHeaderFields 后处理自动提取）
  const TAIL_ROW_PATTERNS = [
    "收货门店", "收货人", "收货电话", "收货地址", "收货机构", "收货单位",
    "联系电话", "联系人", "审核人", "审核：", "审核:",
    "制单人", "制单：", "制单:",
    "经办人", "经办：", "经办:",
    "打印时间", "打印日期", "打印：", "打印:",
    "调拨日期", "调拨单号", "配送日期",
    "门店名称", "门店编号",
    // 单据元数据（行首是"单据号"/"配送单号"等的元数据行，不当数据行）
    "单据号", "配送单号", "配送发货单", "运单号", "订单号",
    "上游单据", "上游单号", "创建日期", "创建人",
    "分拣员", "分拣状态", "复审状态", "复审时间", "发货操作时间",
    "备注", "收货机构备注", "收货人签字",
  ];

  for (let r = startRow; r < Math.min(endRow, data.length); r++) {
    const rowData = data[r];
    if (!rowData || rowData.length === 0) continue;

    // 检查是否所有单元格都为空
    const hasContent = rowData.some((c) => c !== null && c !== undefined && String(c).trim() !== "");
    if (!hasContent) continue;

    // 检查合计行
    if (rule.postProcessing?.skipTotalRow) {
      const rowText = rowData.map((c) => String(c ?? "")).join(" ");
      if (rowText.includes(rule.postProcessing.totalRowPattern || "合计")) continue;
    }

    // 检查是否尾部/info 行（"收货门店：xxx" 等键值对格式）
    // 避免尾部行被当作数据行保留
    if (!isCardMode) {
      const firstColText = String(rowData[0] ?? "").trim();
      if (firstColText && TAIL_ROW_PATTERNS.some((p) => firstColText.includes(p))) {
        continue;
      }
    }

    const cells: Record<string, string> = {};
    for (let col = 0; col < rowData.length; col++) {
      const headerName = headers[col] || `col_${col}`;
      cells[headerName] = String(rowData[col] ?? "");
      cells[`col_${col}`] = String(rowData[col] ?? "");
    }
    // ===== 关键：保存 headerName → colIdx 反向映射到 cells 外的 row.headerColIdx =====
    // 解决空值场景下"值匹配"不可靠的问题（如"银泰"列首行值是空字符串时）
    // 下游 transposeMatrix 用这个表直接查 storeColumnIndices
    // 注意：必须存到 row 上而不是 cells 里——cells 是"列名→值"映射，混入对象会污染所有
    //       `Object.values(cells).join(" ")` / `.filter(v => v.trim())` 等遍历
    const headerColIdx: Record<string, number> = {};
    for (let col = 0; col < rowData.length; col++) {
      const headerName = headers[col] || `col_${col}`;
      if (!(headerName in headerColIdx)) headerColIdx[headerName] = col;
    }

    rows.push({ rowIndex: r, cells, tailFields: {}, headerColIdx });
  }

  // 数据前/后区元数据提取：扫描所有行（除 SKU 数据行外），提取 key-value 元数据
  // （如"收货机构：xxx"、"单据号：PS2512xxx"、"收货人：张三"、"收货电话：185xxx"、
  //   "收货地址：xxx"等），这些字段不在 SKU 表头中，而在表前/表后元数据行里
  // 例如 12.25海口龙湖天街发货单：行1/2/3 是表前元数据，行8/9/10 是表后元数据
  const preHeaderFields: Record<string, string> = {};
  const preHeaderKeyMap: Record<string, string> = {
    storeName: "收货机构|收货门店|收货单位|调入门店|客户名称",
    externalCode: "单据编号|单据号|配送单号|配送发货单|调拨单号|运单号|订单号",
    recipientName: "收货人|收件人|联系人|收货人姓名",
    recipientPhone: "收货电话|收件人电话|联系电话|收货人手机号|手机号|手机",
    recipientAddress: "收货地址|收件人地址|详细地址|收货详细地址",
  };
  // 元数据行特征：首列（col_0）等于某个 key，且后续 cell 中有非空 value
  // 同时行内容不能用 SKU 表头中的标准列名（"序号"、"物品编码" 等），避免把数据行误判为元数据行
  const SKU_HEADER_KEYWORDS = ["序号", "物品编码", "物品名称", "物品分类", "物品品牌", "规格型号", "存储方式", "分拣员", "分拣状态", "订货单位", "发货数量", "订货数量", "接单数量", "发货金额", "成本金额", "物品重量", "物品体积", "发货仓库", "基准单位", "分拣单位", "合计"];
  for (let r = 0; r < data.length; r++) {
    const rowData = data[r];
    if (!rowData) continue;
    // 跳过表头行本身（避免把表头当元数据候选行）
    if (r === headerRow) continue;
    const firstCell = String(rowData[0] ?? "").trim();
    if (!firstCell) continue;
    // 跳过 SKU 表头/数据行（行内容以"序号"/"物品编码"开头）
    if (SKU_HEADER_KEYWORDS.some((kw) => firstCell === kw || firstCell.startsWith(kw + " ") || firstCell.startsWith(kw + "　"))) {
      // 这是 SKU 表头或数据行，跳过
      if (firstCell === "序号" || firstCell === "合计") continue;
      // 数据行：序号是 1/2/3... 是数字开头
      if (/^\d+$/.test(firstCell)) continue;
    }
    // 检查首列是否匹配某个 metadata key
    // 关键：单 cell 情况下也要进 n 循环（n=0）— 用 `n <= 0` 让 n=0 始终能进
    const maxN = Math.max(0, rowData.length - 1);
    for (let n = 0; n <= maxN; n++) {
      const rawKey = String(rowData[n] ?? "").trim();
      if (!rawKey) continue;

      // ===== 关键：先做"同 cell 多 key:value 切分"（PDF 视觉行被合并场景）=====
      // 如果当前 cell 内有 ≥2 个 key:value 对，按"中文+冒号"边界切分后逐个匹配
      // 这样每个 key 拿到的是真正的"它自己的 value"，不会被下一个 key 串进来
      // 注意：split 按"空白+中文+冒号"位置切，切点前的所有字符（含 |）都会保留在上一段，
      //       所以切分后必须把每段 value 末尾的 | / ｜ / 空白清除
      if (n === 0 && /[一-鿿]+[：:][^：:]+?(?=\s+[一-鿿]+[：:]|$)/.test(rawKey)) {
        const allPairs = rawKey.split(/\s+(?=[一-鿿]+[：:])/);
        for (const pair of allPairs) {
          const cIdx = pair.search(/[：:]/);
          if (cIdx < 0) continue;
          const pKey = pair.substring(0, cIdx).trim();
          // 关键：清除 value 末尾的 | / ｜（split 切点前会保留这个符号）
          const pValue = pair.substring(cIdx + 1).replace(/\s*[|｜]\s*$/, "").trim();
          for (const [target, patterns] of Object.entries(preHeaderKeyMap)) {
            if (preHeaderFields[target]) continue;
            const pl = patterns.split("|");
            if (pl.some((p) => pKey === p || pKey.startsWith(p))) {
              if (pValue && !SKU_HEADER_KEYWORDS.includes(pValue)) {
                preHeaderFields[target] = pValue;
                break;
              }
            }
          }
        }
        // 多 key 提取后，本 cell 已被处理完，跳过单 key 提取
        continue;
      }

      // ===== 单 key 提取（cell 内只有 1 个 key:value）=====
      const colonIdx = rawKey.search(/[：:]/);
      const key = colonIdx >= 0 ? rawKey.substring(0, colonIdx).trim() : rawKey;
      const inlineValue = colonIdx >= 0 ? rawKey.substring(colonIdx + 1).trim() : "";
      for (const [target, patterns] of Object.entries(preHeaderKeyMap)) {
        const patternList = patterns.split("|");
        const matchedPattern = patternList.find((p) => key === p || key.startsWith(p));
        if (matchedPattern) {
          // 优先用同 cell 的 inline value，没有再取下一个非空 cell
          let value = "";
          if (inlineValue && !SKU_HEADER_KEYWORDS.includes(inlineValue)) {
            value = inlineValue;
          } else {
            for (let m = n + 1; m < rowData.length; m++) {
              const v = String(rowData[m] ?? "").trim();
              if (v && !SKU_HEADER_KEYWORDS.includes(v)) {
                value = v;
                break;
              }
            }
          }
          if (value && !preHeaderFields[target]) preHeaderFields[target] = value;
          break;
        }
      }
    }
  }
  // 应用到所有数据行
  if (Object.keys(preHeaderFields).length > 0) {
    console.log(`[excelToRawData] 从表前/表后元数据行提取到: ${Object.keys(preHeaderFields).join(", ")}`);
    for (const row of rows) {
      row.tailFields = { ...preHeaderFields, ...row.tailFields };
    }
  }

  // ====== 关键：兜底扫描表前/表后所有"行"提取元数据（即使在 rows2d 之外）======
  // 适用于 PDF/Word 等"表前元数据行"被 rows2d 排除的场景：
  // 解析器（file-parser）的二维表抽取只保留了"表头行+数据行"，但 key:value 元数据行
  // （如"收货机构：xxx"）被丢在外面。这里我们从 data 全集里重新扫一次：
  // —— 任何不在 headerRow 之前/之后数据范围内的行，都视为元数据候选
  if (Object.keys(preHeaderFields).length < 5) {
    // 已有 preHeaderFields 不足时，强制全文档扫描
    const enriched: Record<string, string> = {};
    for (let r = 0; r < data.length; r++) {
      if (r === headerRow) continue;
      const rowData = data[r];
      if (!rowData) continue;
      const rowText = rowData.map((c) => String(c ?? "")).join(" ");
      for (const [target, patterns] of Object.entries(preHeaderKeyMap)) {
        if (enriched[target]) continue;
        for (const p of patterns.split("|")) {
          const re = new RegExp(p + "[：:]\\s*([^\\s：:][^：:]*?)(?=\\s+[一-鿿][：:]|$)");
          const m = rowText.match(re);
          if (m && m[1] && !SKU_HEADER_KEYWORDS.includes(m[1].trim())) {
            enriched[target] = m[1].trim();
            break;
          }
        }
      }
    }
    if (Object.keys(enriched).length > 0) {
      console.log(`[excelToRawData] 兜底扫描: 找到 ${Object.keys(enriched).length} 字段: ${Object.keys(enriched).join(", ")}`);
      for (const row of rows) {
        row.tailFields = { ...enriched, ...row.tailFields };
      }
    }
  }

  // 尾部信息提取
  if (config.tailRegion && config.tailRegion.startRow !== undefined) {
    // 容错窗口：从配置的 startRow 向前最多 5 行开始搜索
    // 防止启发式/AI 配置 startRow 略晚于实际尾部时漏掉关键字段
    const configuredStart = config.tailRegion.startRow;
    const tailStart = Math.max(0, configuredStart - 5);
    const tailFields: Record<string, string> = {};

    for (let r = tailStart; r < data.length; r++) {
      const rowData = data[r];
      if (!rowData) continue;

      const rowText = rowData.map((c) => String(c ?? "")).join(" ");
      // 跳过含"合计"等合计行，避免把合计值误当尾部字段
      if (rule.postProcessing?.skipTotalRow && rowText.includes(rule.postProcessing.totalRowPattern || "合计")) {
        continue;
      }

      for (const field of config.tailRegion.fields) {
        if (field.mode === "tail_extract" && field.regexPattern) {
          const match = rowText.match(new RegExp(field.regexPattern));
          if (match && !tailFields[field.targetField]) {
            tailFields[field.targetField] = match[field.regexGroup || 1] || match[0];
          }
        } else if (field.mode === "row_field" && field.rowKeyPattern) {
          if (rowText.includes(field.rowKeyPattern)) {
            // 按单元格提取：找到 key 所在 col_ 索引，取下一个非空单元格
            // 避免贪婪正则吞掉同行其他字段
            for (let n = 0; n < 200; n++) {
              const cellVal = String(rowData[n] ?? "");
              if (cellVal.includes(field.rowKeyPattern)) {
                for (let m = n + 1; m < rowData.length; m++) {
                  const v = String(rowData[m] ?? "").trim();
                  if (v) {
                    if (!tailFields[field.targetField]) tailFields[field.targetField] = v;
                    break;
                  }
                }
                break;
              }
            }
          }
        }
      }
    }

    // 将尾部字段应用到所有行
    for (const row of rows) {
      row.tailFields = { ...tailFields };
    }
  }

  return rows;
}

// ====== OrderItem 字段安全访问 ======
function setOrderField(order: OrderItem, field: string, value: string) {
  const o = order as unknown as Record<string, unknown>;
  o[field] = value;
}

function getOrderField(order: OrderItem, field: string): unknown {
  const o = order as unknown as Record<string, unknown>;
  return o[field];
}
