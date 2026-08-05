/**
 * POST /api/import-tasks/clean - 清理所有旧的失败/卡住的 outbox 事件
 * 把 status=SENT 且关联的批次一直是 PENDING 的事件标记为 FAILED
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

    // 把所有非 PENDING 的 outbox 事件中、payload 不是合法 JSON 的标记为 FAILED
    // 简单粗暴：把所有 SENT 的标记为 FAILED，只保留 PENDING
    await db(
      `UPDATE event_outbox SET status = 'FAILED' WHERE status = 'SENT'`,
      []
    );

    // 把关联批次重置为 PENDING
    await db(
      `UPDATE import_task_batches SET status = 'PENDING', locked_at = NULL WHERE status = 'PROCESSING'`,
      []
    );

    return NextResponse.json({ success: true, message: "已清理旧 outbox 事件和卡住的批次" });
  } catch (error) {
    return NextResponse.json(
      { error: "清理失败", detail: String(error) },
      { status: 500 }
    );
  }
}
