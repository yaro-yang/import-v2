/**
 * POST /api/import-tasks/reinit - 强制重建 V4 表（DROP + CREATE）
 * 会丢失所有导入任务、批次、错误、outbox、性能日志数据
 */
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("数据库连接未配置");
  return neon(url);
}

export async function POST() {
  try {
    const db = getSql();

    // DROP 所有 V4 表（级联删除）
    await db`DROP TABLE IF EXISTS trace_events CASCADE`;
    await db`DROP TABLE IF EXISTS batch_performance_log CASCADE`;
    await db`DROP TABLE IF EXISTS event_outbox CASCADE`;
    await db`DROP TABLE IF EXISTS import_task_errors CASCADE`;
    await db`DROP TABLE IF EXISTS import_task_batches CASCADE`;
    await db`DROP TABLE IF EXISTS import_tasks CASCADE`;

    // 重建（用最新 DDL）
    await db`
      CREATE TABLE IF NOT EXISTS import_tasks (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_data BYTEA,
        rule_id TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        total_rows INTEGER NOT NULL DEFAULT 0,
        processed_rows INTEGER NOT NULL DEFAULT 0,
        success_rows INTEGER NOT NULL DEFAULT 0,
        failed_rows INTEGER NOT NULL DEFAULT 0,
        total_batches INTEGER NOT NULL DEFAULT 0,
        completed_batches INTEGER NOT NULL DEFAULT 0,
        trace_id TEXT,
        degraded BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS idx_import_tasks_status ON import_tasks(status)`;
    await db`CREATE INDEX IF NOT EXISTS idx_import_tasks_created_at ON import_tasks(created_at)`;

    await db`
      CREATE TABLE import_task_batches (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES import_tasks(id) ON DELETE CASCADE,
        batch_index INTEGER NOT NULL,
        start_row INTEGER NOT NULL,
        end_row INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        retry_count INTEGER NOT NULL DEFAULT 0,
        locked_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        UNIQUE(task_id, batch_index)
      )
    `;

    await db`
      CREATE TABLE import_task_errors (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES import_tasks(id) ON DELETE CASCADE,
        batch_index INTEGER NOT NULL,
        row_number INTEGER NOT NULL,
        field_name TEXT NOT NULL,
        raw_value TEXT NOT NULL DEFAULT '',
        error_code TEXT NOT NULL,
        error_reason TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS idx_import_task_errors_task_batch ON import_task_errors(task_id, batch_index)`;
    await db`CREATE INDEX IF NOT EXISTS idx_import_task_errors_error_code ON import_task_errors(error_code)`;

    await db`
      CREATE TABLE event_outbox (
        id TEXT PRIMARY KEY,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'PENDING',
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        sent_at TIMESTAMPTZ
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS idx_event_outbox_status_retry ON event_outbox(status, next_retry_at)`;

    await db`
      CREATE TABLE batch_performance_log (
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await db`
      CREATE TABLE trace_events (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        batch_index INTEGER,
        event_name TEXT NOT NULL,
        event_status TEXT NOT NULL DEFAULT 'OK',
        message TEXT NOT NULL DEFAULT '',
        occurred_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS idx_trace_events_trace_occurred ON trace_events(trace_id, occurred_at)`;

    return NextResponse.json({ success: true, message: "V4 表已删除并重建（最新 DDL）" });
  } catch (error) {
    return NextResponse.json(
      { error: "重建失败", detail: String(error) },
      { status: 500 }
    );
  }
}
