// GET /api/import-tasks/search - Trace 多条件检索
// 支持 task_id, trace_id, file_name, batch_index, row_number, error_code

import { NextRequest, NextResponse } from "next/server";
import { searchTraces } from "@/lib/db-v4";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const params = {
      task_id: url.searchParams.get("task_id") || undefined,
      trace_id: url.searchParams.get("trace_id") || undefined,
      file_name: url.searchParams.get("file_name") || undefined,
      batch_index: url.searchParams.get("batch_index") ? parseInt(url.searchParams.get("batch_index")!) : undefined,
      row_number_min: url.searchParams.get("row_number_min") ? parseInt(url.searchParams.get("row_number_min")!) : undefined,
      row_number_max: url.searchParams.get("row_number_max") ? parseInt(url.searchParams.get("row_number_max")!) : undefined,
      error_code: url.searchParams.get("error_code") || undefined,
    };

    const result = await searchTraces(params);

    return NextResponse.json({
      tasks: result.tasks,
      errors: result.errors,
      events: result.events,
    });
  } catch (error) {
    console.error("[import-tasks] 搜索失败:", error);
    return NextResponse.json(
      { error: "搜索失败", detail: String(error) },
      { status: 500 }
    );
  }
}
