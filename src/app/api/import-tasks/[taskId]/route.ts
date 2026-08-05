// GET /api/import-tasks/[taskId] - 查询任务进度
// GET /api/import-tasks/[taskId]?include=batches - 包含批次信息

import { NextRequest, NextResponse } from "next/server";
import { getImportTask, getTaskBatches } from "@/lib/db-v4";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const task = await getImportTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const url = new URL(request.url);
    const include = url.searchParams.get("include");

    let batches = undefined;
    if (include === "batches") {
      batches = await getTaskBatches(taskId);
    }

    return NextResponse.json({
      task_id: task.id,
      file_name: task.file_name,
      status: task.status,
      total_rows: task.total_rows,
      processed_rows: task.processed_rows,
      success_rows: task.success_rows,
      failed_rows: task.failed_rows,
      total_batches: task.total_batches,
      completed_batches: task.completed_batches,
      degraded: task.degraded,
      trace_id: task.trace_id,
      created_at: task.created_at,
      completed_at: task.completed_at,
      ...(batches && { batches }),
    });
  } catch (error) {
    console.error("[import-tasks] 查询任务失败:", error);
    return NextResponse.json(
      { error: "查询失败", detail: String(error) },
      { status: 500 }
    );
  }
}
