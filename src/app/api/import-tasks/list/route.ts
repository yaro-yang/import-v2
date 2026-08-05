// GET /api/import-tasks/list - 获取任务列表
import { NextRequest, NextResponse } from "next/server";
import { listImportTasks } from "@/lib/db-v4";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const tasks = await listImportTasks(limit, offset);

    return NextResponse.json({
      tasks: tasks.map((t) => ({
        task_id: t.id,
        file_name: t.file_name,
        status: t.status,
        total_rows: t.total_rows,
        processed_rows: t.processed_rows,
        success_rows: t.success_rows,
        failed_rows: t.failed_rows,
        total_batches: t.total_batches,
        completed_batches: t.completed_batches,
        trace_id: t.trace_id,
        degraded: t.degraded,
        created_at: t.created_at,
        completed_at: t.completed_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "查询失败", detail: String(error) },
      { status: 500 }
    );
  }
}
