// V4 异步事件驱动导入数据库层
// 新增表：import_tasks, import_task_batches, import_task_errors,
//          event_outbox, batch_performance_log, trace_events, sku_master

import { neon } from "@neondatabase/serverless";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// 类型定义
// ============================================================

export type TaskStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "PARTIAL_SUCCESS" | "FAILED";
export type BatchStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type OutboxStatus = "PENDING" | "SENT" | "FAILED";

export interface ImportTask {
  id: string;
  file_name: string;
  file_path: string;
  rule_id: string;
  status: TaskStatus;
  total_rows: number;
  processed_rows: number;
  success_rows: number;
  failed_rows: number;
  total_batches: number;
  completed_batches: number;
  trace_id: string;
  degraded: boolean;
  created_at: string;
  completed_at: string | null;
}

export interface ImportTaskBatch {
  id: string;
  task_id: string;
  batch_index: number;
  start_row: number;
  end_row: number;
  status: BatchStatus;
  retry_count: number;
  locked_at: string | null;
  completed_at: string | null;
}

export interface ImportTaskError {
  id: string;
  task_id: string;
  batch_index: number;
  row_number: number;
  field_name: string;
  raw_value: string;
  error_code: string;
  error_reason: string;
  trace_id: string;
  created_at: string;
}

export interface EventOutbox {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: string;
  status: OutboxStatus;
  retry_count: number;
  next_retry_at: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface BatchPerformanceLog {
  id: string;
  task_id: string;
  batch_index: number;
  parse_duration_ms: number;
  rule_duration_ms: number;
  validate_duration_ms: number;
  insert_duration_ms: number;
  total_duration_ms: number;
  status: string;
  trace_id: string;
  created_at: string;
}

export interface TraceEvent {
  id: string;
  trace_id: string;
  task_id: string;
  batch_index: number | null;
  event_name: string;
  event_status: string;
  message: string;
  occurred_at: string;
}

export interface SkuMaster {
  id: string;
  sku_code: string;
  name: string;
  spec: string;
  unit: string;
  created_at: string;
}

// ============================================================
// 数据库连接
// ============================================================

let sql: ReturnType<typeof neon> | null = null;

function getSql() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("数据库连接未配置");
    sql = neon(url);
  }
  return sql;
}

// ============================================================
// 表初始化
// ============================================================

export async function initV4Tables(): Promise<void> {
  const db = getSql();

  // sku_master - SKU 主数据
  await db`
    CREATE TABLE IF NOT EXISTS sku_master (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      spec TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;

  // import_tasks - 导入任务主表
  await db`
    CREATE TABLE IF NOT EXISTS import_tasks (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      total_rows INTEGER NOT NULL DEFAULT 0,
      processed_rows INTEGER NOT NULL DEFAULT 0,
      success_rows INTEGER NOT NULL DEFAULT 0,
      failed_rows INTEGER NOT NULL DEFAULT 0,
      total_batches INTEGER NOT NULL DEFAULT 0,
      completed_batches INTEGER NOT NULL DEFAULT 0,
      trace_id TEXT NOT NULL,
      degraded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE
    )
  `;

  // import_task_batches - 处理单元状态表
  await db`
    CREATE TABLE IF NOT EXISTS import_task_batches (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES import_tasks(id) ON DELETE CASCADE,
      batch_index INTEGER NOT NULL,
      start_row INTEGER NOT NULL,
      end_row INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER NOT NULL DEFAULT 0,
      locked_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(task_id, batch_index)
    )
  `;

  // import_task_errors - 行级错误明细
  await db`
    CREATE TABLE IF NOT EXISTS import_task_errors (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES import_tasks(id) ON DELETE CASCADE,
      batch_index INTEGER NOT NULL,
      row_number INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      raw_value TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL,
      error_reason TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;

  // event_outbox - 本地可靠事件表
  await db`
    CREATE TABLE IF NOT EXISTS event_outbox (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      sent_at TIMESTAMP WITH TIME ZONE
    )
  `;

  // batch_performance_log - 处理单元性能日志
  await db`
    CREATE TABLE IF NOT EXISTS batch_performance_log (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES import_tasks(id) ON DELETE CASCADE,
      batch_index INTEGER NOT NULL,
      parse_duration_ms INTEGER NOT NULL DEFAULT 0,
      rule_duration_ms INTEGER NOT NULL DEFAULT 0,
      validate_duration_ms INTEGER NOT NULL DEFAULT 0,
      insert_duration_ms INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      trace_id TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;

  // trace_events - 链路时间线事件
  await db`
    CREATE TABLE IF NOT EXISTS trace_events (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      batch_index INTEGER,
      event_name TEXT NOT NULL,
      event_status TEXT NOT NULL DEFAULT 'OK',
      message TEXT NOT NULL DEFAULT '',
      occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;

  // 创建索引
  await db`CREATE INDEX IF NOT EXISTS idx_sku_master_sku_code ON sku_master(sku_code)`;
  await db`CREATE INDEX IF NOT EXISTS idx_import_tasks_status_created ON import_tasks(status, created_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_import_tasks_trace_id ON import_tasks(trace_id)`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS idx_import_task_batches_task_batch ON import_task_batches(task_id, batch_index)`;
  await db`CREATE INDEX IF NOT EXISTS idx_import_task_errors_task_batch ON import_task_errors(task_id, batch_index)`;
  await db`CREATE INDEX IF NOT EXISTS idx_import_task_errors_error_code ON import_task_errors(error_code)`;
  await db`CREATE INDEX IF NOT EXISTS idx_event_outbox_status_retry ON event_outbox(status, next_retry_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_batch_performance_log_task ON batch_performance_log(task_id, batch_index)`;
  await db`CREATE INDEX IF NOT EXISTS idx_trace_events_trace_occurred ON trace_events(trace_id, occurred_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_trace_events_task_id ON trace_events(task_id)`;
}

// ============================================================
// SKU 主数据操作
// ============================================================

export async function seedSkuMaster(skus: Array<{ sku_code: string; name: string; spec: string; unit: string }>): Promise<number> {
  const db = getSql();
  let count = 0;
  // 分批插入
  const batchSize = 500;
  for (let i = 0; i < skus.length; i += batchSize) {
    const batch = skus.slice(i, i + batchSize);
    const values = batch.map((s) => ({
      id: uuidv4(),
      sku_code: s.sku_code,
      name: s.name,
      spec: s.spec,
      unit: s.unit,
    }));
    for (const v of values) {
      await db`
        INSERT INTO sku_master (id, sku_code, name, spec, unit)
        VALUES (${v.id}, ${v.sku_code}, ${v.name}, ${v.spec}, ${v.unit})
        ON CONFLICT (sku_code) DO UPDATE SET name = EXCLUDED.name, spec = EXCLUDED.spec, unit = EXCLUDED.unit
      `;
      count++;
    }
  }
  return count;
}

export async function clearSkuMaster(): Promise<void> {
  const db = getSql();
  await db`DELETE FROM sku_master`;
}

export async function batchCheckSkus(skuCodes: string[]): Promise<Map<string, SkuMaster>> {
  const db = getSql();
  const result = new Map<string, SkuMaster>();
  if (skuCodes.length === 0) return result;

  const rows = await db`
    SELECT * FROM sku_master WHERE sku_code = ANY(${skuCodes})
  ` as SkuMaster[];

  for (const row of rows) {
    result.set(row.sku_code, row);
  }
  return result;
}

// ============================================================
// 导入任务操作
// ============================================================

export async function createImportTask(data: {
  file_name: string;
  file_path: string;
  rule_id: string;
  total_rows: number;
  total_batches: number;
  batch_size: number;
  trace_id: string;
}): Promise<ImportTask> {
  const db = getSql();
  const taskId = `task_${uuidv4().replace(/-/g, "").slice(0, 12)}`;

  const task: ImportTask = {
    id: taskId,
    file_name: data.file_name,
    file_path: data.file_path,
    rule_id: data.rule_id,
    status: "PENDING",
    total_rows: data.total_rows,
    processed_rows: 0,
    success_rows: 0,
    failed_rows: 0,
    total_batches: data.total_batches,
    completed_batches: 0,
    trace_id: data.trace_id,
    degraded: false,
    created_at: new Date().toISOString(),
    completed_at: null,
  };

  await db`
    INSERT INTO import_tasks (id, file_name, file_path, rule_id, status, total_rows, processed_rows, success_rows, failed_rows, total_batches, completed_batches, trace_id, degraded, created_at)
    VALUES (${task.id}, ${task.file_name}, ${task.file_path}, ${task.rule_id}, ${task.status}, ${task.total_rows}, ${task.processed_rows}, ${task.success_rows}, ${task.failed_rows}, ${task.total_batches}, ${task.completed_batches}, ${task.trace_id}, ${task.degraded}, ${task.created_at})
  `;

  return task;
}

export async function getImportTask(taskId: string): Promise<ImportTask | null> {
  const db = getSql();
  const rows = await db`SELECT * FROM import_tasks WHERE id = ${taskId}` as ImportTask[];
  return rows.length > 0 ? rows[0] : null;
}

export async function listImportTasks(limit = 50, offset = 0): Promise<ImportTask[]> {
  const db = getSql();
  return await db`
    SELECT * FROM import_tasks ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
  ` as ImportTask[];
}

export async function updateTaskProgress(taskId: string, data: {
  processed_rows?: number;
  success_rows?: number;
  failed_rows?: number;
  completed_batches?: number;
  status?: TaskStatus;
  degraded?: boolean;
  completed_at?: string | null;
}): Promise<void> {
  const db = getSql();
  // 使用参数化更新，避免 SQL 注入
  if (data.processed_rows !== undefined) {
    await db`UPDATE import_tasks SET processed_rows = ${data.processed_rows} WHERE id = ${taskId}`;
  }
  if (data.success_rows !== undefined) {
    await db`UPDATE import_tasks SET success_rows = ${data.success_rows} WHERE id = ${taskId}`;
  }
  if (data.failed_rows !== undefined) {
    await db`UPDATE import_tasks SET failed_rows = ${data.failed_rows} WHERE id = ${taskId}`;
  }
  if (data.completed_batches !== undefined) {
    await db`UPDATE import_tasks SET completed_batches = ${data.completed_batches} WHERE id = ${taskId}`;
  }
  if (data.status !== undefined) {
    await db`UPDATE import_tasks SET status = ${data.status} WHERE id = ${taskId}`;
  }
  if (data.degraded !== undefined) {
    await db`UPDATE import_tasks SET degraded = ${data.degraded} WHERE id = ${taskId}`;
  }
  if (data.completed_at !== undefined) {
    await db`UPDATE import_tasks SET completed_at = ${data.completed_at ?? null} WHERE id = ${taskId}`;
  }
}

// 原子更新进度（避免并发问题）
export async function atomicUpdateTaskProgress(taskId: string, data: {
  processed_rows_delta?: number;
  success_rows_delta?: number;
  failed_rows_delta?: number;
  completed_batches_delta?: number;
  status?: TaskStatus;
  degraded?: boolean;
  completed_at?: string | null;
}): Promise<void> {
  const db = getSql();
  // 逐字段原子更新
  if (data.processed_rows_delta) {
    await db`UPDATE import_tasks SET processed_rows = processed_rows + ${data.processed_rows_delta} WHERE id = ${taskId}`;
  }
  if (data.success_rows_delta) {
    await db`UPDATE import_tasks SET success_rows = success_rows + ${data.success_rows_delta} WHERE id = ${taskId}`;
  }
  if (data.failed_rows_delta) {
    await db`UPDATE import_tasks SET failed_rows = failed_rows + ${data.failed_rows_delta} WHERE id = ${taskId}`;
  }
  if (data.completed_batches_delta) {
    await db`UPDATE import_tasks SET completed_batches = completed_batches + ${data.completed_batches_delta} WHERE id = ${taskId}`;
  }
  if (data.status) {
    await db`UPDATE import_tasks SET status = ${data.status} WHERE id = ${taskId}`;
  }
  if (data.degraded !== undefined) {
    await db`UPDATE import_tasks SET degraded = ${data.degraded} WHERE id = ${taskId}`;
  }
  if (data.completed_at !== undefined) {
    await db`UPDATE import_tasks SET completed_at = ${data.completed_at ?? null} WHERE id = ${taskId}`;
  }
}

// ============================================================
// 批次操作
// ============================================================

export async function createBatch(taskId: string, batchIndex: number, startRow: number, endRow: number): Promise<ImportTaskBatch> {
  const db = getSql();
  // 使用可预测的 id 格式：task_id + "_" + batch_index
  const batchId = `${taskId}_${batchIndex}`;
  const batch: ImportTaskBatch = {
    id: batchId,
    task_id: taskId,
    batch_index: batchIndex,
    start_row: startRow,
    end_row: endRow,
    status: "PENDING",
    retry_count: 0,
    locked_at: null,
    completed_at: null,
  };

  await db`
    INSERT INTO import_task_batches (id, task_id, batch_index, start_row, end_row, status, retry_count)
    VALUES (${batch.id}, ${batch.task_id}, ${batch.batch_index}, ${batch.start_row}, ${batch.end_row}, ${batch.status}, ${batch.retry_count})
    ON CONFLICT (task_id, batch_index) DO NOTHING
  `;

  return batch;
}

export async function lockBatch(batchId: string): Promise<ImportTaskBatch | null> {
  const db = getSql();
  const rows = await db`
    UPDATE import_task_batches
    SET status = 'PROCESSING', locked_at = NOW()
    WHERE id = ${batchId} AND status = 'PENDING'
    RETURNING *
  ` as ImportTaskBatch[];
  return rows.length > 0 ? rows[0] : null;
}

export async function completeBatch(batchId: string, status: BatchStatus): Promise<void> {
  const db = getSql();
  await db`
    UPDATE import_task_batches
    SET status = ${status}, completed_at = NOW()
    WHERE id = ${batchId}
  `;
}

export async function incrementBatchRetry(batchId: string): Promise<void> {
  const db = getSql();
  await db`
    UPDATE import_task_batches
    SET retry_count = retry_count + 1, status = 'PENDING', locked_at = NULL
    WHERE id = ${batchId}
  `;
}

export async function getTaskBatches(taskId: string): Promise<ImportTaskBatch[]> {
  const db = getSql();
  return await db`
    SELECT * FROM import_task_batches WHERE task_id = ${taskId} ORDER BY batch_index
  ` as ImportTaskBatch[];
}

export async function getBatchById(batchId: string): Promise<ImportTaskBatch | null> {
  const db = getSql();
  const rows = await db`SELECT * FROM import_task_batches WHERE id = ${batchId}` as ImportTaskBatch[];
  return rows.length > 0 ? rows[0] : null;
}

// 扫描卡死批次（锁定超过5分钟）
export async function findStuckBatches(timeoutMinutes = 5): Promise<ImportTaskBatch[]> {
  const db = getSql();
  return await db`
    SELECT * FROM import_task_batches
    WHERE status = 'PROCESSING'
    AND locked_at < NOW() - INTERVAL '${timeoutMinutes} minutes'
  ` as ImportTaskBatch[];
}

// ============================================================
// 错误记录操作
// ============================================================

export async function insertTaskErrors(errors: Array<{
  task_id: string;
  batch_index: number;
  row_number: number;
  field_name: string;
  raw_value: string;
  error_code: string;
  error_reason: string;
  trace_id: string;
}>): Promise<void> {
  const db = getSql();
  if (errors.length === 0) return;

  for (const e of errors) {
    await db`
      INSERT INTO import_task_errors (id, task_id, batch_index, row_number, field_name, raw_value, error_code, error_reason, trace_id)
      VALUES (${uuidv4()}, ${e.task_id}, ${e.batch_index}, ${e.row_number}, ${e.field_name}, ${e.raw_value}, ${e.error_code}, ${e.error_reason}, ${e.trace_id})
    `;
  }
}

export async function getTaskErrors(taskId: string, filters?: {
  batch?: number;
  error_code?: string;
  page?: number;
  page_size?: number;
}): Promise<{ errors: ImportTaskError[]; total: number }> {
  const db = getSql();
  const page = filters?.page || 1;
  const pageSize = filters?.page_size || 50;
  const offset = (page - 1) * pageSize;

  if (filters?.batch !== undefined) {
    // 无法直接追加条件，改用单独查询
    const batch = filters.batch;
    if (filters?.error_code) {
      const ec = filters.error_code;
      const cnt = await db`SELECT COUNT(*) as cnt FROM import_task_errors WHERE task_id = ${taskId} AND batch_index = ${batch} AND error_code = ${ec}` as Array<{ cnt: number }>;
      const total = cnt[0]?.cnt || 0;
      const errors = await db`SELECT * FROM import_task_errors WHERE task_id = ${taskId} AND batch_index = ${batch} AND error_code = ${ec} ORDER BY batch_index, row_number LIMIT ${pageSize} OFFSET ${offset}` as ImportTaskError[];
      return { errors, total };
    }
    const cnt = await db`SELECT COUNT(*) as cnt FROM import_task_errors WHERE task_id = ${taskId} AND batch_index = ${batch}` as Array<{ cnt: number }>;
    const total = cnt[0]?.cnt || 0;
    const errors = await db`SELECT * FROM import_task_errors WHERE task_id = ${taskId} AND batch_index = ${batch} ORDER BY batch_index, row_number LIMIT ${pageSize} OFFSET ${offset}` as ImportTaskError[];
    return { errors, total };
  }

  if (filters?.error_code) {
    const ec = filters.error_code;
    const cnt = await db`SELECT COUNT(*) as cnt FROM import_task_errors WHERE task_id = ${taskId} AND error_code = ${ec}` as Array<{ cnt: number }>;
    const total = cnt[0]?.cnt || 0;
    const errors = await db`SELECT * FROM import_task_errors WHERE task_id = ${taskId} AND error_code = ${ec} ORDER BY batch_index, row_number LIMIT ${pageSize} OFFSET ${offset}` as ImportTaskError[];
    return { errors, total };
  }

  const cnt = await db`SELECT COUNT(*) as cnt FROM import_task_errors WHERE task_id = ${taskId}` as Array<{ cnt: number }>;
  const total = cnt[0]?.cnt || 0;
  const errors = await db`SELECT * FROM import_task_errors WHERE task_id = ${taskId} ORDER BY batch_index, row_number LIMIT ${pageSize} OFFSET ${offset}` as ImportTaskError[];

  return { errors, total };
}

// 获取错误类型分布
export async function getErrorDistribution(taskId?: string): Promise<Array<{ error_code: string; count: number }>> {
  const db = getSql();
  if (taskId) {
    return await db`
      SELECT error_code, COUNT(*) as count
      FROM import_task_errors
      WHERE task_id = ${taskId}
      GROUP BY error_code
      ORDER BY count DESC
    ` as Array<{ error_code: string; count: number }>;
  }
  return await db`
    SELECT error_code, COUNT(*) as count
    FROM import_task_errors
    GROUP BY error_code
    ORDER BY count DESC
  ` as Array<{ error_code: string; count: number }>;
}

// ============================================================
// Outbox 操作
// ============================================================

export async function createOutboxEvents(events: Array<{
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}>): Promise<void> {
  const db = getSql();
  for (const e of events) {
    await db`
      INSERT INTO event_outbox (id, aggregate_id, event_type, payload, status)
      VALUES (${uuidv4()}, ${e.aggregate_id}, ${e.event_type}, ${JSON.stringify(e.payload)}, 'PENDING')
    `;
  }
}

export async function fetchPendingOutboxEvents(limit = 10): Promise<EventOutbox[]> {
  const db = getSql();
  return await db`
    SELECT * FROM event_outbox
    WHERE status = 'PENDING'
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY created_at
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  ` as EventOutbox[];
}

export async function markOutboxSent(eventId: string): Promise<void> {
  const db = getSql();
  await db`
    UPDATE event_outbox SET status = 'SENT', sent_at = NOW() WHERE id = ${eventId}
  `;
}

export async function markOutboxFailed(eventId: string): Promise<void> {
  const db = getSql();
  await db`
    UPDATE event_outbox
    SET status = 'FAILED', retry_count = retry_count + 1,
        next_retry_at = NOW() + INTERVAL '${Math.min(2 ** (await getRetryCount(eventId)), 60)} seconds'
    WHERE id = ${eventId}
  `;
}

async function getRetryCount(eventId: string): Promise<number> {
  const db = getSql();
  const rows = await db`SELECT retry_count FROM event_outbox WHERE id = ${eventId}` as Array<{ retry_count: number }>;
  return rows[0]?.retry_count || 0;
}

// ============================================================
// 性能日志操作
// ============================================================

export async function insertPerformanceLog(log: {
  task_id: string;
  batch_index: number;
  parse_duration_ms: number;
  rule_duration_ms: number;
  validate_duration_ms: number;
  insert_duration_ms: number;
  total_duration_ms: number;
  status: string;
  trace_id: string;
}): Promise<void> {
  const db = getSql();
  await db`
    INSERT INTO batch_performance_log (id, task_id, batch_index, parse_duration_ms, rule_duration_ms, validate_duration_ms, insert_duration_ms, total_duration_ms, status, trace_id)
    VALUES (${uuidv4()}, ${log.task_id}, ${log.batch_index}, ${log.parse_duration_ms}, ${log.rule_duration_ms}, ${log.validate_duration_ms}, ${log.insert_duration_ms}, ${log.total_duration_ms}, ${log.status}, ${log.trace_id})
  `;
}

export async function getTaskPerformanceLogs(taskId: string): Promise<BatchPerformanceLog[]> {
  const db = getSql();
  return await db`
    SELECT * FROM batch_performance_log WHERE task_id = ${taskId} ORDER BY batch_index
  ` as BatchPerformanceLog[];
}

export async function getStagePerformanceStats(): Promise<{
  parse: { p50: number; p95: number; p99: number };
  rule: { p50: number; p95: number; p99: number };
  validate: { p50: number; p95: number; p99: number };
  insert: { p50: number; p95: number; p99: number };
}> {
  const db = getSql();
  // 简化实现：用 AVG 替代 PERCENTILE_CONT（Neon 支持基本聚合）
  const zeroStats = { p50: 0, p95: 0, p99: 0 };

  try {
    const allLogs = await db`SELECT * FROM batch_performance_log` as BatchPerformanceLog[];
    if (allLogs.length === 0) {
      return { parse: zeroStats, rule: zeroStats, validate: zeroStats, insert: zeroStats };
    }

    const calc = (field: keyof BatchPerformanceLog) => {
      const values = allLogs.map((l) => l[field] as number).sort((a, b) => a - b);
      const p50 = values[Math.floor(values.length * 0.5)] || 0;
      const p95 = values[Math.floor(values.length * 0.95)] || 0;
      const p99 = values[Math.floor(values.length * 0.99)] || 0;
      return { p50, p95, p99 };
    };

    return {
      parse: calc("parse_duration_ms"),
      rule: calc("rule_duration_ms"),
      validate: calc("validate_duration_ms"),
      insert: calc("insert_duration_ms"),
    };
  } catch {
    return { parse: zeroStats, rule: zeroStats, validate: zeroStats, insert: zeroStats };
  }
}

// ============================================================
// Trace 事件操作
// ============================================================

export async function insertTraceEvent(event: {
  trace_id: string;
  task_id: string;
  batch_index?: number | null;
  event_name: string;
  event_status?: string;
  message?: string;
}): Promise<void> {
  const db = getSql();
  await db`
    INSERT INTO trace_events (id, trace_id, task_id, batch_index, event_name, event_status, message)
    VALUES (${uuidv4()}, ${event.trace_id}, ${event.task_id}, ${event.batch_index ?? null}, ${event.event_name}, ${event.event_status ?? "OK"}, ${event.message ?? ""})
  `;
}

export async function getTraceEvents(traceId: string): Promise<TraceEvent[]> {
  const db = getSql();
  return await db`
    SELECT * FROM trace_events WHERE trace_id = ${traceId} ORDER BY occurred_at
  ` as TraceEvent[];
}

export async function getTaskTraceEvents(taskId: string): Promise<TraceEvent[]> {
  const db = getSql();
  return await db`
    SELECT * FROM trace_events WHERE task_id = ${taskId} ORDER BY occurred_at
  ` as TraceEvent[];
}

// ============================================================
// 监控聚合
// ============================================================

export async function getMonitorSummary(): Promise<{
  throughput_5min: Array<{ minute: string; rows: number }>;
  queue_depth: { pending_batches: number; pending_rows: number };
  stage_stats: { parse: { p50: number; p95: number; p99: number }; rule: { p50: number; p95: number; p99: number }; validate: { p50: number; p95: number; p99: number }; insert: { p50: number; p95: number; p99: number } };
  error_distribution: Array<{ error_code: string; count: number }>;
  recent_tasks: ImportTask[];
}> {
  const db = getSql();

  // 过去5分钟吞吐（简化：返回最近5分钟的批次记录）
  const recentLogs = await db`
    SELECT * FROM batch_performance_log
    WHERE created_at >= NOW() - INTERVAL '5 minutes'
    ORDER BY created_at
  ` as BatchPerformanceLog[];

  // 队列积压
  const pendingBatches = await db`SELECT COUNT(*) as cnt FROM import_task_batches WHERE status = 'PENDING'` as Array<{ cnt: number }>;
  const pendingRows = await db`
    SELECT COALESCE(SUM(total_rows - processed_rows), 0) as cnt
    FROM import_tasks
    WHERE status IN ('PENDING', 'PROCESSING')
  ` as Array<{ cnt: number }>;

  const stageStats = await getStagePerformanceStats();
  const errorDist = await getErrorDistribution();
  const recentTasks = await listImportTasks(10, 0);

  // 从 batch_performance_log 推算每分钟吞吐（假设每批1000行）
  // 按分钟分组
  const minuteMap = new Map<string, number>();
  for (const log of recentLogs) {
    const minute = new Date(log.created_at).toISOString().slice(0, 16);
    minuteMap.set(minute, (minuteMap.get(minute) || 0) + 1000);
  }
  const throughput5min = Array.from(minuteMap.entries())
    .map(([minute, rows]) => ({ minute, rows }))
    .sort((a, b) => a.minute.localeCompare(b.minute));

  return {
    throughput_5min: throughput5min,
    queue_depth: {
      pending_batches: pendingBatches[0]?.cnt || 0,
      pending_rows: pendingRows[0]?.cnt || 0,
    },
    stage_stats: stageStats,
    error_distribution: errorDist,
    recent_tasks: recentTasks,
  };
}

// 根据 traceId / taskId / 文件名 / 行号搜索
export async function searchTraces(params: {
  task_id?: string;
  trace_id?: string;
  file_name?: string;
  batch_index?: number;
  row_number_min?: number;
  row_number_max?: number;
  error_code?: string;
}): Promise<{ tasks: ImportTask[]; errors: ImportTaskError[]; events: TraceEvent[] }> {
  const db = getSql();

  let tasks: ImportTask[] = [];

  // 按条件查询任务
  if (params.task_id) {
    tasks = await db`SELECT * FROM import_tasks WHERE id = ${params.task_id} LIMIT 20` as ImportTask[];
  } else if (params.trace_id) {
    tasks = await db`SELECT * FROM import_tasks WHERE trace_id = ${params.trace_id} LIMIT 20` as ImportTask[];
  } else if (params.file_name) {
    tasks = await db`SELECT * FROM import_tasks WHERE file_name ILIKE ${`%${params.file_name}%`} ORDER BY created_at DESC LIMIT 20` as ImportTask[];
  } else {
    tasks = await db`SELECT * FROM import_tasks ORDER BY created_at DESC LIMIT 20` as ImportTask[];
  }

  const taskIds = tasks.map((t) => t.id);
  let errors: ImportTaskError[] = [];
  let events: TraceEvent[] = [];

  if (taskIds.length > 0) {
    // 查询错误
    if (params.batch_index !== undefined && params.error_code) {
      errors = await db`SELECT * FROM import_task_errors WHERE task_id = ANY(${taskIds}) AND batch_index = ${params.batch_index} AND error_code = ${params.error_code} ORDER BY task_id, batch_index, row_number LIMIT 100` as ImportTaskError[];
    } else if (params.batch_index !== undefined) {
      errors = await db`SELECT * FROM import_task_errors WHERE task_id = ANY(${taskIds}) AND batch_index = ${params.batch_index} ORDER BY task_id, batch_index, row_number LIMIT 100` as ImportTaskError[];
    } else if (params.error_code) {
      errors = await db`SELECT * FROM import_task_errors WHERE task_id = ANY(${taskIds}) AND error_code = ${params.error_code} ORDER BY task_id, batch_index, row_number LIMIT 100` as ImportTaskError[];
    } else {
      errors = await db`SELECT * FROM import_task_errors WHERE task_id = ANY(${taskIds}) ORDER BY task_id, batch_index, row_number LIMIT 100` as ImportTaskError[];
    }

    // 查询事件
    const traceIds = tasks.map((t) => t.trace_id);
    events = await db`SELECT * FROM trace_events WHERE trace_id = ANY(${traceIds}) ORDER BY occurred_at LIMIT 200` as TraceEvent[];
  }

  return { tasks, errors, events };
}

// ============================================================
// 数据清理
// ============================================================

export async function cleanupOldTasks(daysOld = 30): Promise<number> {
  const db = getSql();
  await db`
    DELETE FROM import_tasks
    WHERE created_at < NOW() - INTERVAL '${daysOld} days'
  `;
  // Neon DELETE 不返回受影响行数，返回 0
  return 0;
}
