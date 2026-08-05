import { readFile } from "fs/promises";
import { resolve } from "path";
import * as XLSX from "xlsx";
import { getRuleById } from "./db";
import {
  lockBatch,
  completeBatch,
  getBatchById,
  insertTaskErrors,
  insertPerformanceLog,
  atomicUpdateTaskProgress,
} from "./db-v4";
import { writeBatch } from "./db-v4-writer";
import { excelToRawData, executeRule } from "./rule-engine";
import { analyzeFileWithAI } from "./ai-service";
import { maskValue, classifyError, type V4ErrorCode } from "./v4-core";
import type { ParseRule, OrderItem, ValidationError } from "../types";

export interface ProcessBatchParams {
  task_id: string;
  batch_index: number;
  start_row: number;
  end_row: number;
  file_path: string;
  rule_id: string;
  trace_id: string;
}

async function readExcelAllSheets(filePath: string): Promise<(string | number | null)[][]> {
  let buf: Buffer;
  if (/^https?:\/\//.test(filePath)) {
    // 部署到 Vercel 等无本地磁盘环境：从 Blob 存储拉取
    const res = await fetch(filePath);
    const ab = await res.arrayBuffer();
    buf = Buffer.from(ab);
  } else {
    buf = await readFile(resolve(process.cwd(), filePath));
  }
  const wb = XLSX.read(buf, { type: "buffer", cellStyles: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false }) as (
    | string
    | number
    | null
  )[][];
}

// 考点9：AI 兜底 —— 优先用 AI 生成解析规则(90% 字段直出)，失败时回退到已保存规则引擎(10% 兜底)
async function resolveRule(
  data: (string | number | null)[][],
  ruleId: string,
): Promise<ParseRule> {
  const stored = await getRuleById(ruleId);
  if (!stored) throw new Error(`rule not found: ${ruleId}`);
  try {
    const sampleRows = data.slice(0, 11).map((r) => r.map((c) => String(c ?? "").trim()));
    const ai = await analyzeFileWithAI({
      fileContent: JSON.stringify(data.slice(0, 20)),
      fileName: "import.xlsx",
      fileType: "excel",
      sampleRows,
    });
    if (ai?.suggestedRule && ai.confidence >= 0.6) {
      // AI 规则优先，已保存规则兜底合并；AI 缺失字段用 stored 补足
      const merged: ParseRule = {
        ...stored,
        ...(ai.suggestedRule as ParseRule),
        fieldMappings: ai.suggestedRule.fieldMappings ?? stored.fieldMappings ?? [],
      } as ParseRule;
      return merged;
    }
  } catch {
    // AI 不可用，走规则引擎兜底
  }
  return stored;
}

function mapOrderToRow(o: OrderItem): Record<string, unknown> {
  return {
    orderNo: o.externalCode ?? "",
    skuCode: o.skuCode,
    skuName: o.skuName,
    qty: o.skuQuantity,
    recipient: o.recipientName ?? "",
    phone: o.recipientPhone ?? "",
    address: o.recipientAddress ?? "",
    remark: o.remark ?? "",
  };
}

export async function processBatch(params: ProcessBatchParams): Promise<{
  success: boolean;
  successCount: number;
  errorCount: number;
}> {
  const { task_id, batch_index, file_path, rule_id, trace_id, start_row, end_row } = params;
  const batchId = `${task_id}_${batch_index}`;

  // 考点8：悲观锁防重复消费（幂等）
  const locked = await lockBatch(batchId);
  if (!locked) {
    const b = await getBatchById(batchId);
    if (b && b.status === "COMPLETED") return { success: true, successCount: 0, errorCount: 0 };
    return { success: false, successCount: 0, errorCount: 0 };
  }

  const startedAt = Date.now();
  // 解析阶段
  const parseStart = Date.now();
  const data = await readExcelAllSheets(file_path);
  const rule = await resolveRule(data, rule_id);
  const rawData = excelToRawData(data, rule);
  const parseMs = Date.now() - parseStart;

  // 规则/AI 阶段
  const ruleStart = Date.now();
  const { orders, errors } = await executeRule(rawData, rule, file_path);
  const ruleMs = Date.now() - ruleStart;

  // 切片当前批次（按行区间）
  const sliceStart = Math.max(0, start_row);
  const sliceEnd = Math.min(orders.length, end_row);
  const batchOrders = orders.slice(sliceStart, sliceEnd);
  const batchErrors = errors.filter((e) => e.row >= sliceStart && e.row < sliceEnd);

  // 脱敏 + 组装写入行
  const validateStart = Date.now();
  const mappedRows: Record<string, unknown>[] = [];
  const passthroughRows: Record<string, unknown>[] = [];
  for (const o of batchOrders) {
    const row = mapOrderToRow(o);
    for (const f of Object.keys(row)) {
      row[f] = maskValue(f, row[f]);
    }
    mappedRows.push(row);
    // 考点10：未识别字段透传（订单模型之外字段原样存 JSON）
    const extra: Record<string, unknown> = { ...o } as Record<string, unknown>;
    delete extra.skuCode;
    delete extra.skuName;
    delete extra.skuQuantity;
    delete extra.externalCode;
    delete extra.recipientName;
    delete extra.recipientPhone;
    delete extra.recipientAddress;
    delete extra.remark;
    passthroughRows.push(extra);
  }
  const validateMs = Date.now() - validateStart;

  // 写入阶段（考点7 RR 隔离级别在 writeBatch 内 SET LOCAL）
  const insertStart = Date.now();
  const { inserted } = await writeBatch(
    task_id,
    batch_index,
    mappedRows,
    passthroughRows,
    trace_id,
  );
  const insertMs = Date.now() - insertStart;

  // 错误明细（考点11：行号 + 字段名 + 原始值）
  const errorRecs = batchErrors
    .filter((e) => e.severity === "error")
    .map((e: ValidationError) => ({
      task_id,
      batch_index,
      row_number: e.row + 1,
      field_name: e.field,
      raw_value: String(
        (batchOrders[e.row - sliceStart] as unknown as Record<string, unknown>)?.[e.field] ?? "",
      ),
      error_code: classifyError(e.field, e.message) as V4ErrorCode,
      error_reason: e.message,
      trace_id,
    }));
  if (errorRecs.length) await insertTaskErrors(errorRecs);

  // 性能日志（各阶段 ms，用于 P50/P95/P99）
  await insertPerformanceLog({
    task_id,
    batch_index,
    parse_duration_ms: parseMs,
    rule_duration_ms: ruleMs,
    validate_duration_ms: validateMs,
    insert_duration_ms: insertMs,
    total_duration_ms: Date.now() - startedAt,
    status: "COMPLETED",
    trace_id,
  });

  // 进度聚合
  await atomicUpdateTaskProgress(task_id, {
    success_rows_delta: inserted,
    failed_rows_delta: errorRecs.length,
    completed_batches_delta: 1,
  });
  await completeBatch(batchId, "COMPLETED");

  return { success: true, successCount: inserted, errorCount: errorRecs.length };
}

// 供脚本 / 测试使用
export const V4Worker = { processBatch, readExcelAllSheets };
export default V4Worker;
