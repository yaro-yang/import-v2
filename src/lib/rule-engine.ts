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
        const errs = validateOrder(order, rawData.length);
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
        const errs = validateOrder(order, rawData.length);
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
            const sepMatch = after.match(/^\s*[|｜：:]\s*(.+?)(?:\s*[|｜]|$)/);
            if (sepMatch) {
              const v = sepMatch[1].trim();
              if (v && v !== "·" && v !== "-") return v;
            }
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
      // 最后再尝试 column_name 等普通模式
      if (!value) {
        value = extractFieldValue(cardRows[0], mapping);
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
  let filteredData = rawData;
  if (rule.postProcessing?.skipTotalRow) {
    const pattern = rule.postProcessing.totalRowPattern || "合计";
    filteredData = rawData.filter((row) => {
      const rowText = Object.values(row.cells).join(" ");
      return !rowText.includes(pattern);
    });
  }

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
        const errs = validateOrder(order, rawData.length);
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
        const errs = validateOrder(order, rawData.length);
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
        const errs = validateOrder(order, rawData.length);
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

  // 如果配置中已有有效的索引和名称，直接使用
  const hasValidConfig = storeIndices.length > 0 && storeNames.length === storeIndices.length;

  if (!hasValidConfig) {
    // 兜底：从 cells 命名 key 中推断索引
    const firstDataRow = rawData[0];
    const namedKeys = Object.keys(firstDataRow.cells).filter(
      (k) => !k.startsWith("col_") && !k.startsWith("_transposed")
    );

    if (storeNames.length > 0) {
      // 有名称没索引：按名匹配（注意同名会映射多个）
      for (const name of storeNames) {
        for (let c = 0; c < 200; c++) {
          if (firstDataRow.cells[`col_${c}`] === firstDataRow.cells[name] && firstDataRow.cells[name] !== "") {
            storeIndices.push(c);
            break;
          }
        }
      }
    }

    if (storeIndices.length === 0) {
      const standardKeywords = [
        "编码", "名称", "数量", "规格", "单位", "SKU", "条码", "库存", "状态", "备注", "序号", "分类",
        "品牌", "仓库", "日期", "货主", "商品", "分配", "结余", "在库", "可用", "待移", "移入", "冻结",
        "单品", "价格", "金额", "总价",
      ];
      const isStandard = (n: string) => standardKeywords.some((kw) => n.includes(kw));
      for (const name of namedKeys) {
        if (name && !isStandard(name) && name.length <= 30) {
          storeNames.push(name);
          for (let c = 0; c < 200; c++) {
            if (firstDataRow.cells[`col_${c}`] === firstDataRow.cells[name]) {
              storeIndices.push(c);
              break;
            }
          }
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
        const rowText = Object.values(row.cells).join(" ");
        const match = rowText.match(new RegExp(`${mapping.rowKeyPattern}[：:]*\\s*(.+)`));
        return match ? match[1].trim() : "";
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

function validateOrder(order: OrderItem, _totalRows: number): ValidationError[] {
  return _validateOrderItem(order);
}

// ====== Excel 数据转换 ======
export function excelToRawData(
  data: (string | number | null | undefined)[][],
  rule: ParseRule
): RawDataRow[] {
  const rows: RawDataRow[] = [];
  const config = rule.dataRegion;
  const headerRow = config.headerRow ?? 0;
  const skipRows = config.skipRows ?? 0;
  const endRow = config.endRows ?? data.length;

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

    const cells: Record<string, string> = {};
    for (let col = 0; col < rowData.length; col++) {
      const headerName = headers[col] || `col_${col}`;
      cells[headerName] = String(rowData[col] ?? "");
      cells[`col_${col}`] = String(rowData[col] ?? "");
    }

    rows.push({ rowIndex: r, cells, tailFields: {} });
  }

  // 尾部信息提取
  if (config.tailRegion && config.tailRegion.startRow !== undefined) {
    const tailStart = config.tailRegion.startRow;
    const tailFields: Record<string, string> = {};

    for (let r = tailStart; r < data.length; r++) {
      const rowData = data[r];
      if (!rowData) continue;

      const rowText = rowData.map((c) => String(c ?? "")).join(" ");

      for (const field of config.tailRegion.fields) {
        if (field.mode === "tail_extract" && field.regexPattern) {
          const match = rowText.match(new RegExp(field.regexPattern));
          if (match && !tailFields[field.targetField]) {
            tailFields[field.targetField] = match[field.regexGroup || 1] || match[0];
          }
        } else if (field.mode === "row_field" && field.rowKeyPattern) {
          if (rowText.includes(field.rowKeyPattern)) {
            const valueMatch = rowText.match(new RegExp(`${field.rowKeyPattern}[：:]*\\s*(.+)`));
            if (valueMatch && !tailFields[field.targetField]) {
              tailFields[field.targetField] = valueMatch[1].trim();
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
