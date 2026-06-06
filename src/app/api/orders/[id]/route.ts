// DELETE /api/orders/[id]
// 删除出库单（cascade 自动删子表 SKU）
// 调拨单模式下会同时删除 transfer_order + 所有调拨明细 + SKU

import { NextRequest, NextResponse } from "next/server";
import { deleteOrder } from "@/lib/db";
import { ensureDB } from "@/lib/ensure-db";
import { ApiResponse } from "@/types";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDB();
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "缺少订单 ID" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    const ok = await deleteOrder(id);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "订单不存在" } as ApiResponse<null>,
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "订单已删除",
    } as ApiResponse<null>);
  } catch (error) {
    console.error("Delete order error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "删除失败",
      } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
