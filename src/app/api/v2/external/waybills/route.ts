// V2 外部接口 - 查询运单列表
import { NextRequest, NextResponse } from "next/server";
import { getOrders } from "@/lib/db";

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== "v3-system-api-key-2024") {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const result = await getOrders({
      externalCode: searchParams.get("externalCode") || undefined,
      recipientName: searchParams.get("recipientName") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      page: parseInt(searchParams.get("page") || "1"),
      pageSize: parseInt(searchParams.get("pageSize") || "20"),
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
