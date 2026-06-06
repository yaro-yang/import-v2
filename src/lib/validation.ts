// 共享校验逻辑 - 服务端（rule-engine）和客户端（DataPreviewTable）共用
// 保证：解析后校验 与 编辑时实时校验 行为一致

import { OrderItem, ValidationError, TEMPERATURE_LEVELS } from "@/types";

// 业务规则常量
export const PHONE_REGEX = /^1[3-9]\d{9}$/;       // 中国大陆手机号
export const PHONE_CLEAN_REGEX = /^1[3-9]\d{9}$/; // 清理空格/括号后的校验

// 清洗电话：去空格/连字符/括号
export function cleanPhone(phone: string): string {
  return phone.replace(/[\s\-()（）]/g, "");
}

// 校验手机号（容错：清理后再校验；至少 7 位才校验，避免空值报错）
export function isValidPhone(phone: string | undefined): boolean {
  if (!phone) return true; // 空值不算错（由"必填"规则负责）
  const cleaned = cleanPhone(phone);
  if (cleaned.length < 7) return false; // 太短
  if (cleaned.length === 11) return PHONE_CLEAN_REGEX.test(cleaned); // 11 位 → 国内手机
  // 非 11 位：放宽到 7-15 位数字（兼容国际号）
  return /^\d{7,15}$/.test(cleaned);
}

// 校验温层
export function isValidTemperatureLevel(level: string | undefined): boolean {
  if (!level) return true; // 空值不算错
  return (TEMPERATURE_LEVELS as readonly string[]).includes(level);
}

// 单条 OrderItem 校验
// 返回所有错误（一次性返回，便于 UI 全部展示）
export function validateOrderItem(order: OrderItem): ValidationError[] {
  const errors: ValidationError[] = [];
  const row = order.sourceRow || 0;

  // 1. 收货信息：门店模式 OR 收件人模式 至少填一组
  const hasGroupA = !!order.storeName;
  const hasGroupB = !!(order.recipientName && order.recipientPhone && order.recipientAddress);
  if (!hasGroupA && !hasGroupB) {
    errors.push({
      row,
      field: "收货信息",
      message: "收货门店 和 收件人信息(姓名/电话/地址) 至少填一组",
      severity: "error",
    });
  }

  // 2. SKU 必填
  if (!order.skuCode || !String(order.skuCode).trim()) {
    errors.push({ row, field: "skuCode", message: "SKU 编码为必填项", severity: "error" });
  }
  if (!order.skuName || !String(order.skuName).trim()) {
    errors.push({ row, field: "skuName", message: "SKU 名称为必填项", severity: "error" });
  }

  // 3. 数量必须为正数
  const qty = Number(order.skuQuantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    errors.push({ row, field: "skuQuantity", message: "发货数量必须为正数", severity: "error" });
  }

  // 4. 电话格式（必填模式下严格）
  if (order.recipientPhone && !isValidPhone(order.recipientPhone)) {
    errors.push({ row, field: "recipientPhone", message: "收件人电话格式不正确", severity: "error" });
  }

  // 5. 重量（可选字段：填了就必须 > 0）
  if (order.weight !== undefined && order.weight !== null && order.weight !== 0) {
    const w = Number(order.weight);
    if (!Number.isFinite(w) || w <= 0) {
      errors.push({ row, field: "weight", message: "重量必须为正数", severity: "error" });
    }
  }

  // 6. 温层（可选字段：填了必须在白名单内）
  if (order.temperatureLevel && !isValidTemperatureLevel(order.temperatureLevel)) {
    errors.push({
      row,
      field: "temperatureLevel",
      message: `温层值不在允许范围内（允许：${TEMPERATURE_LEVELS.join("/")}）`,
      severity: "error",
    });
  }

  // 7. 外部编码格式（如果填写了）：建议是字母+数字组合，长度 4-32
  if (order.externalCode && !/^[A-Za-z0-9\-_]{4,32}$/.test(order.externalCode)) {
    errors.push({
      row,
      field: "externalCode",
      message: "外部编码格式异常（建议 4-32 位字母/数字/中横线/下划线）",
      severity: "warning",
    });
  }

  return errors;
}

// 批量校验：返回所有 OrderItem 的所有错误（展平）+ 错误计数
export function validateOrders(orders: OrderItem[]): {
  errors: ValidationError[];
  errorOrderIds: Set<string>;
  hasError: boolean;
} {
  const allErrors: ValidationError[] = [];
  const errorOrderIds = new Set<string>();
  for (const order of orders) {
    const errs = validateOrderItem(order);
    if (errs.length > 0) {
      errorOrderIds.add(order.id);
      allErrors.push(...errs);
    }
  }
  return { errors: allErrors, errorOrderIds, hasError: allErrors.length > 0 };
}

// 检测同批次内的外部编码重复
// 返回 Map<externalCode, [indices]>（包含至少 2 条的才返回）
export function findBatchDuplicates(orders: OrderItem[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (let i = 0; i < orders.length; i++) {
    const code = (orders[i].externalCode || "").trim();
    if (!code) continue;
    if (!map.has(code)) map.set(code, []);
    map.get(code)!.push(i);
  }
  const duplicates = new Map<string, number[]>();
  for (const [code, indices] of map) {
    if (indices.length >= 2) duplicates.set(code, indices);
  }
  return duplicates;
}
