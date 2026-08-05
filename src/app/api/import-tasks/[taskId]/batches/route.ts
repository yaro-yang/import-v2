// GET /api/import-tasks/[taskId]/batches - 查询任务批次性能

import { NextRequest, NextResponse } from "next/server";
import { getTaskPerformanceLogs, getTaskBatches } from "@/lib/db-v4";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const [batches, perfLogs] = await Promise.all([
      getTaskBatches(taskId),
      getTaskPerformanceLogs(taskId),
    ]);

    // 合并批次状态和性能日志
    const merged = batches.map((batch) => {
      const perf = perfLogs.find((p) => p.batch_index === batch.batch_index);
      return {
        batch_index: batch.batch_index,
        start_row: batch.start_row,
        end_row: batch.end_row,
        status: batch.status,
        retry_count: batch.retry_count,
        locked_at: batch.locked_at,
        completed_at: batch.completed_at,
        ...(perf && {
          performance: {
            parse_duration_ms: perf.parse_duration_ms,
            rule_duration_ms: perf.rule_duration_ms,
            validate_duration_ms: perf.validate_duration_ms,
            insert_duration_ms: perf.insert_duration_ms,
            total_duration_ms: perf.total_duration_ms,
          },
        }),
      };
    });

    return NextResponse.json({ batches: merged });
  } catch (error) {
    console.error("[import-tasks] 查询批次失败:", error);
    return NextResponse.json(
      { error: "查询失败", detail: String(error) },
      { status: 500 }
    );
  }
}
