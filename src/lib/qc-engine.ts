// 品控规则引擎
// 可配置的规则匹配 + 执行过程追溯
// 不硬编码触发条件，所有规则从数据库加载

import { QCRule, ExceptionType, QCResult } from "@/types";
import { DEFAULT_CONFIG } from "./config";

interface ScanContext {
  skuCode: string;
  skuName?: string;
  expectedQuantity?: number;
  actualQuantity?: number;
  damageLevel?: number;
  specDeviation?: boolean;
  labelMatch?: boolean;
  batchValid?: boolean;
  description?: string;
}

interface RuleMatch {
  rule: QCRule;
  matched: boolean;
  reason: string;
  severity: string;
}

/**
 * 执行品控规则引擎检测
 * 返回所有命中的规则及其判定依据
 */
export function executeQCEngine(
  rules: QCRule[],
  context: ScanContext
): { result: QCResult; matches: RuleMatch[]; failReason?: string } {
  const matches: RuleMatch[] = [];
  const enabledRules = rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);

  for (const rule of enabledRules) {
    const matchResult = evaluateRule(rule, context);
    if (matchResult.matched) {
      matches.push(matchResult);
    }
  }

  if (matches.length > 0) {
    // 按严重度排序：critical > high > medium > low
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    matches.sort((a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99));

    const reasons = matches.map((m, i) => `[${i + 1}] 规则「${m.rule.name}」命中：${m.reason}`).join("；");
    return {
      result: "fail",
      matches,
      failReason: reasons,
    };
  }

  return { result: "pass", matches: [] };
}

function evaluateRule(rule: QCRule, context: ScanContext): RuleMatch {
  const fieldValue = getContextField(context, rule.conditionField);
  const threshold = parseConditionValue(rule.conditionValue, rule.conditionField);

  let matched = false;
  let reason = "";

  switch (rule.conditionOperator) {
    case "gt":
      matched = fieldValue > threshold;
      reason = matched
        ? `${rule.conditionField}(${fieldValue}) > 阈值(${threshold})，触发规则`
        : `${rule.conditionField}(${fieldValue}) ≤ 阈值(${threshold})，未触发`;
      break;
    case "lt":
      matched = fieldValue < threshold;
      reason = matched
        ? `${rule.conditionField}(${fieldValue}) < 阈值(${threshold})，触发规则`
        : `${rule.conditionField}(${fieldValue}) ≥ 阈值(${threshold})，未触发`;
      break;
    case "gte":
      matched = fieldValue >= threshold;
      reason = matched
        ? `${rule.conditionField}(${fieldValue}) ≥ 阈值(${threshold})，触发规则`
        : `${rule.conditionField}(${fieldValue}) < 阈值(${threshold})，未触发`;
      break;
    case "lte":
      matched = fieldValue <= threshold;
      reason = matched
        ? `${rule.conditionField}(${fieldValue}) ≤ 阈值(${threshold})，触发规则`
        : `${rule.conditionField}(${fieldValue}) > 阈值(${threshold})，未触发`;
      break;
    case "eq":
      matched = String(fieldValue) === String(rule.conditionValue);
      reason = matched
        ? `${rule.conditionField}(${fieldValue}) == ${rule.conditionValue}，触发规则`
        : `${rule.conditionField}(${fieldValue}) ≠ ${rule.conditionValue}，未触发`;
      break;
    case "neq":
      matched = String(fieldValue) !== String(rule.conditionValue);
      reason = matched
        ? `${rule.conditionField}(${fieldValue}) ≠ ${rule.conditionValue}，触发规则`
        : `${rule.conditionField}(${fieldValue}) == ${rule.conditionValue}，未触发`;
      break;
    case "contains":
      matched = String(fieldValue).includes(String(rule.conditionValue));
      reason = matched
        ? `${rule.conditionField}(${fieldValue}) 包含 ${rule.conditionValue}，触发规则`
        : `${rule.conditionField}(${fieldValue}) 不包含 ${rule.conditionValue}，未触发`;
      break;
  }

  return {
    rule,
    matched,
    reason,
    severity: rule.severity,
  };
}

function getContextField(context: ScanContext, field: string): number | string | boolean {
  switch (field) {
    case "quantity_diff_percent": {
      if (context.expectedQuantity && context.expectedQuantity > 0) {
        const diff = Math.abs((context.actualQuantity || 0) - context.expectedQuantity);
        return Math.round((diff / context.expectedQuantity) * 100);
      }
      return 0;
    }
    case "damage_level":
      return context.damageLevel || 0;
    case "spec_deviation":
      return context.specDeviation ? 1 : 0;
    case "label_match":
      return context.labelMatch === false ? "false" : "true";
    case "batch_valid":
      return context.batchValid === false ? "false" : "true";
    default:
      return 0;
  }
}

function parseConditionValue(value: string, field: string): number {
  if (field === "label_match" || field === "batch_valid") {
    return value === "false" ? 1 : 0;
  }
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

/**
 * 获取默认品控规则（用于首次初始化）
 */
export function getDefaultQCRules(): Omit<QCRule, "id" | "createdAt" | "updatedAt">[] {
  return DEFAULT_CONFIG.qcRules.defaultRules.map((rule, index) => ({
    ...rule,
    priority: index + 1,
    enabled: true,
  }));
}

/**
 * 根据命中的规则确定异常类型和最严重等级
 */
export function determineExceptionFromMatches(
  matches: RuleMatch[]
): { exceptionType: ExceptionType; severity: string; approvalLevel: number } | null {
  if (matches.length === 0) return null;

  // 取最严重的一条规则
  const mostSevere = matches[0];
  return {
    exceptionType: mostSevere.rule.exceptionSubType,
    severity: mostSevere.rule.severity,
    approvalLevel: mostSevere.rule.approvalLevel,
  };
}
