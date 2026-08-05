/**
 * POST /api/import-tasks/reset - 重置卡住的任务
 * 把 outbox 事件从 SENT 重置为 PENDING，批次从 PROCESSING 重置为 PENDING
 */
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("数据库连接未配置");
  return neon(url);
}

export async function POST(request: NextRequest) {
  try {
    const { task_id } = await request.json();
    if (!task_id) {
      return NextResponse.json({ error: "缺少 task_id" }, { status: 400 });
    }

    const db = getSql();

    // 重置 outbox：SENT → PENDING
    await db`
      UPDATE event_outbox
      SET status = 'PENDING'
      WHERE aggregate_id = ${task_id} AND status = 'SENT'
    `;

    // 重置批次：PROCESSING → PENDING
    await db`
      UPDATE import_task_batches
      SET status = 'PENDING', locked_at = NULL
      WHERE task_id = ${task_id} AND status = 'PROCESSING'
    `;

    return NextResponse.json({ success: true, message: `任务 ${task_id} 已重置` });
  } catch (error) {
    return NextResponse.json(
      { error: "重置失败", detail: String(error) },
      { status: 500 }
    );
  }
}
