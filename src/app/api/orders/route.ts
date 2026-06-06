import { NextRequest, NextResponse } from "next/server";
import { saveOrders, getOrders } from "@/lib/db";
import { ensureDB } from "@/lib/ensure-db";
import { ApiResponse, OrderItem } from "@/types";

export async function POST(request: NextRequest) {
  await ensureDB();
  try {
    const body = await request.json();
    // 接收 OrderItem[]（每个 SKU 一条）+ mode（outbound/transfer）
    const { orders, mode } = body as { orders: OrderItem[]; mode?: "outbound" | "transfer" };

    if (!orders || !Array.isArray(orders)) {
      return NextResponse.json(
        { success: false, error: "无效的订单数据" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    // 标记为已提交
    const now = new Date().toISOString();
    const submittedItems = orders.map((order) => ({
      ...order,
      status: "submitted" as const,
      submittedAt: now,
    }));

    // saveOrders 按 mode 聚合：
    //   - outbound: 1 外部编码 = 1 父单（兼容旧行为）
    //   - transfer: 1 外部编码 = 1 调拨单 + N 调拨明细（按 externalCode+storeName 拆分）
    const { savedOutbounds, savedTransfers } = await saveOrders(submittedItems, mode || "outbound");
    const savedSkuCount = submittedItems.length;
    // 按外部编码去重计数（真正有多少张单据）
    const uniqueDocCount = new Set(submittedItems.map((o) => o.externalCode || "__no_code__")).size;

    const message = mode === "transfer"
      ? `成功提交 ${savedTransfers} 张调拨单（${savedOutbounds} 个调拨明细，${savedSkuCount} 条 SKU）`
      : `成功提交 ${uniqueDocCount} 张单据（${savedSkuCount} 条货品）`;

    return NextResponse.json({
      success: true,
      data: { savedCount: savedSkuCount, savedOutbounds: uniqueDocCount, savedTransfers },
      message,
    } as ApiResponse<{ savedCount: number; savedOutbounds: number; savedTransfers: number }>);
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
