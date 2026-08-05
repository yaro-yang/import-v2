// GET /api/import-monitor/summary - 监控聚合数据
// 返回吞吐、队列积压、阶段耗时、错误分布等

import { NextResponse } from "next/server";
import { getMonitorSummary } from "@/lib/db-v4";

export async function GET() {
  try {
    const summary = await getMonitorSummary();

    return NextResponse.json({
      throughput_5min: summary.throughput_5min,
      queue_depth: {
        pending_batches: summary.queue_depth.pending_batches,
        pending_rows: summary.queue_depth.pending_rows,
        alert: summary.queue_depth.pending_rows > 5000 ? "orange" : "green",
      },
      stage_stats: summary.stage_stats,
      error_distribution: summary.error_distribution,
      recent_tasks: summary.recent_tasks.map((t) => ({
        task_id: t.id,
        file_name: t.file_name,
        status: t.status,
        total_rows: t.total_rows,
        success_rows: t.success_rows,
        failed_rows: t.failed_rows,
        created_at: t.created_at,
      })),
    });
  } catch (error) {
    console.error("[import-monitor] 查询失败:", error);
    return NextResponse.json(
      { error: "查询失败", detail: String(error) },
      { status: 500 }
    );
  }
}
