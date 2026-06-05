// 规则引擎 - 核心解析逻辑 V2
// 支持：头部跳过、尾部提取、跨行聚合、矩阵转置、卡片拆分、复合单元格、多Sheet合并、合计行跳过

import { ParseRule, FieldMapping, OrderItem, ValidationError } from "@/types";
import { v4 as uuidv4 } from "uuid";

interface RawDataRow {
  rowIndex: number;
  cells: Record<string, string>;
  sourceSheet?: string;
  tailFields?: Record<string, string>;
}

// ====== 主入口 ======

export async function executeRule(
  rawData: RawDataRow[],
  rule: ParseRule,
  fileName: string
): Promise<{ orders: OrderItem[]; errors: ValidationError[] }> {
  const startTime = performance.now();
  const orders: OrderItem[] = [];
  const errors: ValidationError[] = [];

  // 0. 卡片模式处理
  if (rule.dataRegion.cardMode?.enabled) {
    const cardGroups = splitByCards(rawData, rule);
    for (const group of cardGroups) {
      const order = buildOrderFromRows(group, rule, fileName, "");
      if (order) {
        const errs = validateOrder(order, rawData.length);
        if (errs.length > 0) { order.errors = errs; order.status = "error"; errors.push(...errs); }
        orders.push(order);
      }
    }
  }
  // 1. 复合单元格拆分
  else if (rule.dataRegion.compositeMode?.enabled) {
    const expandedRows = expandCompositeCells(rawData, rule);
    processRows(expandedRows, rule, fileName, orders, errors);
  }
  // 2. 矩阵转置
  else if (rule.dataRegion.matrixMode?.enabled) {
    const transposedRows = transposeMatrix(rawData, rule);
    processRows(transposedRows, rule, fileName, orders, errors);
  }
  // 3. 标准处理
  else {
    processRows(rawData, rule, fileName, orders, errors);
  }

  const endTime = performance.now();
  console.log(`Rule execution completed in ${(endTime - startTime).toFixed(2)}ms`);
  return { orders, errors };
}

function processRows(
  rawData: RawDataRow[],
  rule: ParseRule,
  fileName: string,
  orders: OrderItem[],
  errors: ValidationError[]
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

  // 按外部编码聚合
  if (rule.globalConfig.groupByExternalCode && rule.globalConfig.externalCodeField) {
    const grouped = groupByExternalCode(filteredData, rule);
    for (const [code, rows] of grouped) {
      const order = buildOrderFromRows(rows, rule, fileName, code);
      if (order) {
        const errs = validateOrder(order, rawData.length);
        if (errs.length > 0) { order.errors = errs; order.status = "error"; errors.push(...errs); }
        orders.push(order);
      }
    }
  } else {
    for (const row of filteredData) {
      const order = buildOrderFromRow(row, rule, fileName);
      if (order) {
        const errs = validateOrder(order, rawData.length);
        if (errs.length > 0) { order.errors = errs; order.status = "error"; errors.push(...errs); }
        orders.push(order);
      }
    }
  }
}

// ====== 卡片拆分 ======
function splitByCards(rawData: RawDataRow[], rule: ParseRule): RawDataRow[][] {
  const groups: RawDataRow[][] = [];
  let currentGroup: RawDataRow[] = [];
  const marker = rule.dataRegion.cardMode?.startMarker || "";

  for (const row of rawData) {
    const rowText = Object.values(row.cells).join(" ");
    if (rowText.includes(marker)) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [row];
    } else {
      currentGroup.push(row);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);
  return groups;
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
  const transposed: RawDataRow[] = [];
  const mode = rule.dataRegion.matrixMode;
  if (!mode) return rawData;

  const rowHeaderCol = mode.rowHeaderColumn ?? 0;
  const valueStartCol = mode.valueColumnsStart ?? 1;
  const valueEndCol = mode.valueColumnsEnd ?? 100;

  // 获取列名（门店名/日期等）
  const columnNames: string[] = [];
  const colNameRowIndex = mode.valueColumnNamesRow ?? 0;
  const colNameRow = rawData.find((r) => r.rowIndex === colNameRowIndex);

  for (const row of rawData) {
    const rowHeader = row.cells[`col_${rowHeaderCol}`] || "";
    if (!rowHeader || rowHeader === Object.values(row.cells).find((c) => c === rowHeader && c === "SKU信息" || c === "合计")) continue;

    for (let col = valueStartCol; col <= valueEndCol; col++) {
      const cellValue = row.cells[`col_${col}`];
      if (!cellValue || cellValue.trim() === "" || cellValue === "0" || cellValue === "null") continue;

      const colName = colNameRow?.cells[`col_${col}`] || `col_${col}`;

      const newRow: RawDataRow = {
        rowIndex: row.rowIndex * 1000 + col,
        cells: {
          ...row.cells,
          // 将列名作为门店名
          "_transposed_col_name": colName,
          "_transposed_value": cellValue,
          // 保留行头作为 SKU 信息
          [`col_${rowHeaderCol}`]: rowHeader,
        },
        tailFields: row.tailFields,
      };

      transposed.push(newRow);
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
function buildOrderFromRows(
  rows: RawDataRow[],
  rule: ParseRule,
  fileName: string,
  externalCode: string
): OrderItem | null {
  const firstRow = rows[0];
  const order: OrderItem = {
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

  // 提取收货信息
  for (const mapping of rule.fieldMappings) {
    if (["storeName", "recipientName", "recipientPhone", "recipientAddress", "remark"].includes(mapping.targetField)) {
      let value = extractFieldValue(firstRow, mapping);
      // 矩阵转置模式：门店名来自列名
      if (mapping.targetField === "storeName" && firstRow.cells["_transposed_col_name"]) {
        value = firstRow.cells["_transposed_col_name"];
      }
      if (value) setOrderField(order, mapping.targetField, value);
    }
  }

  // 合并 SKU 信息
  if (rows.length > 1) {
    const skuCodes: string[] = [], skuNames: string[] = [], skuSpecs: string[] = [];
    let totalQty = 0;
    for (const row of rows) {
      const code = extractFieldValue(row, rule.fieldMappings.find((m) => m.targetField === "skuCode"));
      const name = extractFieldValue(row, rule.fieldMappings.find((m) => m.targetField === "skuName"));
      const qty = parseFloat(extractFieldValue(row, rule.fieldMappings.find((m) => m.targetField === "skuQuantity")) || "0");
      const spec = extractFieldValue(row, rule.fieldMappings.find((m) => m.targetField === "skuSpec"));
      if (code) skuCodes.push(code);
      if (name) skuNames.push(name);
      totalQty += qty || 0;
      if (spec) skuSpecs.push(spec);
    }
    order.skuCode = skuCodes.join("; ");
    order.skuName = skuNames.join("; ");
    order.skuQuantity = totalQty;
    order.skuSpec = skuSpecs.join("; ");
  } else {
    order.skuCode = extractFieldValue(rows[0], rule.fieldMappings.find((m) => m.targetField === "skuCode")) || "";
    order.skuName = extractFieldValue(rows[0], rule.fieldMappings.find((m) => m.targetField === "skuName")) || "";
    order.skuQuantity = parseFloat(extractFieldValue(rows[0], rule.fieldMappings.find((m) => m.targetField === "skuQuantity")) || "0");
    order.skuSpec = extractFieldValue(rows[0], rule.fieldMappings.find((m) => m.targetField === "skuSpec")) || "";
  }

  return order;
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
    // 矩阵转置模式
    if (mapping.targetField === "storeName" && row.cells["_transposed_col_name"]) {
      value = row.cells["_transposed_col_name"];
    }
    if (mapping.targetField === "skuQuantity" && row.cells["_qty_" + (mapping.columnName || "")]) {
      value = row.cells["_qty_" + (mapping.columnName || "")];
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
    case "column_name":
      return row.cells[mapping.columnName || ""] || "";
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
    default:
      if (mapping.columnName) return row.cells[mapping.columnName] || "";
      if (mapping.columnIndex !== undefined) return row.cells[`col_${mapping.columnIndex}`] || "";
      return mapping.defaultValue || "";
  }
}

// ====== 校验 ======
function validateOrder(order: OrderItem, _totalRows: number): ValidationError[] {
  const errors: ValidationError[] = [];

  const hasGroupA = !!order.storeName;
  const hasGroupB = !!(order.recipientName && order.recipientPhone && order.recipientAddress);

  if (!hasGroupA && !hasGroupB) {
    errors.push({
      row: order.sourceRow || 0,
      field: "收货信息",
      message: "A组（收货门店）和B组（收件人信息）至少填写一组",
      severity: "error",
    });
  }

  if (!order.skuCode) {
    errors.push({ row: order.sourceRow || 0, field: "skuCode", message: "SKU物品编码为必填项", severity: "error" });
  }
  if (!order.skuName) {
    errors.push({ row: order.sourceRow || 0, field: "skuName", message: "SKU物品名称为必填项", severity: "error" });
  }
  if (!order.skuQuantity || order.skuQuantity <= 0) {
    errors.push({ row: order.sourceRow || 0, field: "skuQuantity", message: "SKU发货数量必须为正数", severity: "error" });
  }

  if (order.recipientPhone) {
    const cleaned = order.recipientPhone.replace(/[\s\-()（）]/g, "");
    if (!/^1[3-9]\d{9}$/.test(cleaned) && cleaned.length >= 10) {
      errors.push({ row: order.sourceRow || 0, field: "recipientPhone", message: "收件人电话格式不正确", severity: "warning" });
    }
  }

  return errors;
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
        headers.push(String(headerData[col] ?? `col_${col}`));
      }
    }
  }

  // 提取数据行
  const startRow = Math.max(skipRows, headerRow + 1);
  for (let r = startRow; r < Math.min(endRow, data.length); r++) {
    const rowData = data[r];
    if (!rowData || rowData.length === 0) continue;

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

      for (const field of config.tailRegion.fields) {
        if (field.mode === "tail_extract" && field.regexPattern) {
          const rowText = rowData.map((c) => String(c ?? "")).join(" ");
          const match = rowText.match(new RegExp(field.regexPattern));
          if (match) {
            tailFields[field.targetField] = match[field.regexGroup || 1] || match[0];
          }
        } else if (field.mode === "row_field" && field.rowKeyPattern) {
          const rowText = rowData.map((c) => String(c ?? "")).join(" ");
          if (rowText.includes(field.rowKeyPattern)) {
            const valueMatch = rowText.match(new RegExp(`${field.rowKeyPattern}[：:]*\\s*(.+)`));
            if (valueMatch) tailFields[field.targetField] = valueMatch[1].trim();
          }
        }
      }
    }

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
