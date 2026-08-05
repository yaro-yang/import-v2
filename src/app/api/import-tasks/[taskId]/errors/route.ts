// GET /api/import-tasks/[taskId]/errors - 查询任务错误明细
// 支持按批次、错误码筛选和分页

import { NextRequest, NextResponse } from "next/server";
import { getTaskErrors } from "@/lib/db-v4";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const url = new URL(request.url);
    const batch = url.searchParams.get("batch") ? parseInt(url.searchParams.get("batch")!) : undefined;
    const error_code = url.searchParams.get("error_code") || undefined;
    const page = url.searchParams.get("page") ? parseInt(url.searchParams.get("page")!) : 1;
    const page_size = url.searchParams.get("page_size") ? parseInt(url.searchParams.get("page_size")!) : 50;

    const result = await getTaskErrors(taskId, { batch, error_code, page, page_size });

    return NextResponse.json({
      errors: result.errors,
      total: result.total,
      page,
      page_size,
      total_pages: Math.ceil(result.total / page_size),
    });
  } catch (error) {
    console.error("[import-tasks] 查询错误失败:", error);
    return NextResponse.json(
      { error: "查询失败", detail: String(error) },
      { status: 500 }
    );
  }
}
