// V3 工单详情 API
import { NextRequest, NextResponse } from "next/server";
import { getTicketById } from "@/lib/db-v3";
import { ApiResponse } from "@/types";

async function ensureInit() {
  try {
    const { initV3DB, initDefaultConfig } = await import("@/lib/db-v3");
    await initV3DB();
    await initDefaultConfig();
  } catch { /* ignore */ }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureInit();

  try {
    const { id } = await params;
    const ticket = await getTicketById(id);
    
    if (!ticket) {
      return NextResponse.json(
        { success: false, error: "工单不存在" } as ApiResponse<null>,
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: ticket } as ApiResponse<typeof ticket>);
  } catch (error) {
    console.error("Get ticket error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "获取工单失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
