// Vercel Cron Job：每 1 分钟自动清理卡住的 outbox 事件和批次
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("数据库连接未配置");
  return neon(url);
}

export async function GET() {
  try {
    const db = getSql();

    // 把 SENT 超过 2 分钟的事件标记为 FAILED
    await db`
      UPDATE event_outbox SET status = 'FAILED'
      WHERE status = 'SENT'
        AND created_at < NOW() - INTERVAL '2 minutes'
    `;

    // 把锁超过 5 分钟的批次重置为 PENDING
    await db`
      UPDATE import_task_batches
      SET status = 'PENDING', locked_at = NULL
      WHERE status = 'PROCESSING'
        AND locked_at < NOW() - INTERVAL '5 minutes'
    `;

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
