// V2 外部接口 - 校验 SKU 是否归属指定运单
import { NextRequest, NextResponse } from "next/server";
import { getOrderById } from "@/lib/db";

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== "v3-system-api-key-2024") {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { waybillId, skuCode } = body as { waybillId: string; skuCode: string };

    if (!waybillId || !skuCode) {
      return NextResponse.json(
        { success: false, error: "waybillId and skuCode are required" },
        { status: 400 }
      );
    }

    const order = await getOrderById(waybillId);
    if (!order) {
      return NextResponse.json(
        { success: false, error: "Waybill not found" },
        { status: 404 }
      );
    }

    const hasSku = order.items?.some((item) => item.skuCode === skuCode);
    return NextResponse.json({
      success: true,
      data: { valid: !!hasSku, waybill: order },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
