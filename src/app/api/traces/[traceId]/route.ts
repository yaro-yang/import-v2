// GET /api/traces/[traceId] - 查询链路追踪时间线

import { NextRequest, NextResponse } from "next/server";
import { getTraceEvents, getImportTask } from "@/lib/db-v4";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ traceId: string }> }
) {
  const { traceId } = await params;

  try {
    const events = await getTraceEvents(traceId);

    // 尝试找关联任务
    let task = null;
    for (const ev of events) {
      if (ev.task_id) {
        task = await getImportTask(ev.task_id);
        break;
      }
    }

    const timeline = events.map((e) => ({
      occurred_at: e.occurred_at,
      event_name: e.event_name,
      event_status: e.event_status,
      message: e.message,
      batch_index: e.batch_index,
    }));

    return NextResponse.json({
      trace_id: traceId,
      ...(task && {
        task_id: task.id,
        file_name: task.file_name,
        status: task.status,
        total_rows: task.total_rows,
        success_rows: task.success_rows,
        failed_rows: task.failed_rows,
      }),
      timeline,
    });
  } catch (error) {
    console.error("[traces] 查询Trace失败:", error);
    return NextResponse.json(
      { error: "查询失败", detail: String(error) },
      { status: 500 }
    );
  }
}
