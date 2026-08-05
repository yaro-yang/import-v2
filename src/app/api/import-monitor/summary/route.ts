// GET /api/import-monitor/summary - 监控聚合数据
// 返回吞吐、队列积压、阶段耗时、错误分布等

import { NextResponse } from "next/server";
import { getMonitorSummary } from "@/lib/db-v4";

export async function GET() {
  try {
    const summary = await getMonitorSummary();

    const pendingRows = Number(summary.queue_depth.pending_rows);
    const alert = pendingRows > 10000 ? "red" : pendingRows > 5000 ? "yellow" : "green";
    const response = NextResponse.json({
      throughput_5min: summary.throughput_5min,
      queue_depth: {
        pending_batches: summary.queue_depth.pending_batches,
        pending_rows: summary.queue_depth.pending_rows,
        alert,
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

    // 告警头：外部监控系统（如 UptimeRobot/Datadog）可检测这些 header
    if (alert !== "green") {
      response.headers.set("X-Queue-Alert", alert);
      response.headers.set("X-Queue-Pending-Rows", String(summary.queue_depth.pending_rows));
    }

    return response;
  } catch (error) {
    console.error("[import-monitor] 查询失败:", error);
    return NextResponse.json(
      { error: "查询失败", detail: String(error) },
      { status: 500 }
    );
  }
}
