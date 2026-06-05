import { NextRequest, NextResponse } from "next/server";
import { saveOrders, getOrders } from "@/lib/db";
import { ensureDB } from "@/lib/ensure-db";
import { ApiResponse, OrderItem } from "@/types";

export async function POST(request: NextRequest) {
  await ensureDB();
  try {
    const body = await request.json();
    const { orders } = body as { orders: OrderItem[] };

    if (!orders || !Array.isArray(orders)) {
      return NextResponse.json(
        { success: false, error: "无效的订单数据" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    // 标记为已提交
    const now = new Date().toISOString();
    const submittedOrders = orders.map((order) => ({
      ...order,
      status: "submitted" as const,
      submittedAt: now,
    }));

    const savedCount = await saveOrders(submittedOrders);

    return NextResponse.json({
      success: true,
      data: { savedCount },
      message: `成功提交 ${savedCount} 条运单`,
    } as ApiResponse<{ savedCount: number }>);
  } catch (error) {
    console.error("Save orders error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "保存失败",
      } as ApiResponse<null>,
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  await ensureDB();
  try {
    const { searchParams } = new URL(request.url);
    const externalCode = searchParams.get("externalCode") || undefined;
    const recipientName = searchParams.get("recipientName") || undefined;
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");

    const result = await getOrders({
      externalCode,
      recipientName,
      page,
      pageSize,
    });

    return NextResponse.json({
      success: true,
      data: result,
    } as ApiResponse<typeof result>);
  } catch (error) {
    console.error("Get orders error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "获取失败",
      } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
