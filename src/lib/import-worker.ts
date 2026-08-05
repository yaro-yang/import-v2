import * as XLSX from "xlsx";
import { neon } from "@neondatabase/serverless";
import { getRuleById } from "./db";
import {
  lockBatch,
  completeBatch,
  getBatchById,
  getImportTask,
  insertTaskErrors,
  insertPerformanceLog,
  insertTraceEvent,
  atomicUpdateTaskProgress,
} from "./db-v4";
import { writeBatch } from "./db-v4-writer";
import { excelToRawData, executeRule } from "./rule-engine";
import { analyzeFileWithAI } from "./ai-service";
import { maskValue, classifyError, toStandardErrorCode, type V4ErrorCode } from "./v4-core";
import type { ParseRule, OrderItem, ValidationError } from "../types";

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("数据库连接未配置");
  return neon(url);
}

export interface ProcessBatchParams {
  task_id: string;
  batch_index: number;
  start_row: number;
  end_row: number;
  rule_id: string;
  trace_id: string;
  file_url?: string;
}

// 从数据库或 URL 读取文件（Vercel Serverless 无本地磁盘）
async function readExcelForTask(taskId: string, fileUrl?: string): Promise<(string | number | null)[][]> {
  let buf: Buffer;

  if (fileUrl) {
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`下载文件失败: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    const db = getSql();
    const rows = await db`SELECT file_data FROM import_tasks WHERE id = ${taskId}` as Array<{ file_data: Buffer | null }>;
    if (!rows.length || !rows[0].file_data) {
      throw new Error(`任务 ${taskId} 文件数据不存在`);
    }
    buf = Buffer.from(rows[0].file_data);
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
  const { task_id, batch_index, rule_id, trace_id, start_row, end_row, file_url } = params;
  const batchId = `${task_id}_${batch_index}`;

  // 考点8：悲观锁防重复消费（幂等）
  const locked = await lockBatch(batchId);
  if (!locked) {
    const b = await getBatchById(batchId);
    if (b && b.status === "COMPLETED") return { success: true, successCount: 0, errorCount: 0 };
    return { success: false, successCount: 0, errorCount: 0 };
  }

  const startedAt = Date.now();

  // Trace: 批次开始
  await insertTraceEvent({
    trace_id,
    task_id,
    batch_index,
    event_name: "ImportBatchStarted",
    event_status: "OK",
    message: `批次 ${batch_index} 开始处理 (行 ${start_row + 1}-${end_row})`,
  });

  // 解析阶段：从 DB 或 URL 读取文件
  const parseStart = Date.now();
  const data = await readExcelForTask(task_id, file_url);
  const rule = await resolveRule(data, rule_id);
  const rawData = excelToRawData(data, rule);
  const parseMs = Date.now() - parseStart;

  // 规则/AI 阶段
  const ruleStart = Date.now();
  const { orders, errors } = await executeRule(rawData, rule, `task_${task_id}`);
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
    .map((e: ValidationError) => {
      const rawVal = (batchOrders[e.row - sliceStart] as unknown as Record<string, unknown>)?.[e.field];
      return {
        task_id,
        batch_index,
        row_number: e.row + 1,
        field_name: e.field,
        raw_value: maskValue(e.field, rawVal), // 脱敏后再落库
        error_code: toStandardErrorCode(classifyError(e.field, e.message)),
        error_reason: e.message,
        trace_id,
      };
    });
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

  // 检查是否所有批次完成，更新任务最终状态
  const task = await getImportTask(task_id);
  if (task && task.completed_batches >= task.total_batches) {
    const finalStatus = task.failed_rows > 0 ? "PARTIAL_SUCCESS" : "COMPLETED";
    await atomicUpdateTaskProgress(task_id, {
      status: finalStatus,
      completed_at: new Date().toISOString(),
    });
    await insertTraceEvent({
      trace_id,
      task_id,
      event_name: finalStatus === "COMPLETED" ? "ImportTaskCompleted" : "ImportTaskPartialSuccess",
      event_status: "OK",
      message: `任务完成: 成功 ${task.success_rows + inserted}, 失败 ${task.failed_rows + errorRecs.length}`,
    });
  }

  // Trace: 批次成功
  await insertTraceEvent({
    trace_id,
    task_id,
    batch_index,
    event_name: "ImportBatchSucceeded",
    event_status: "OK",
    message: `批次 ${batch_index} 完成: 成功 ${inserted}, 失败 ${errorRecs.length}, 耗时 ${Date.now() - startedAt}ms`,
  });

  return { success: true, successCount: inserted, errorCount: errorRecs.length };
}

// 供脚本 / 测试使用
export const V4Worker = { processBatch, readExcelForTask };
export default V4Worker;
