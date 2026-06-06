// DELETE /api/transfer-orders/[id]
// 删除调拨单（CASCADE 自动删除所有调拨明细 + SKU）

import { NextRequest, NextResponse } from "next/server";
import { deleteTransferOrder } from "@/lib/db";
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
        { success: false, error: "缺少调拨单 ID" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    const ok = await deleteTransferOrder(id);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "调拨单不存在" } as ApiResponse<null>,
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "调拨单已删除",
    } as ApiResponse<null>);
  } catch (error) {
    console.error("Delete transfer order error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "删除失败",
      } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
