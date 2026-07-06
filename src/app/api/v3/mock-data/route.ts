// V3 模拟数据生成 API
import { NextRequest, NextResponse } from "next/server";
import { generateMockTickets } from "@/lib/db-v3";
import { ApiResponse } from "@/types";

async function ensureInit() {
  try {
    const { initV3DB, initDefaultConfig } = await import("@/lib/db-v3");
    await initV3DB();
    await initDefaultConfig();
  } catch { /* ignore */ }
}

export async function POST(request: NextRequest) {
  await ensureInit();
  try {
    const body = await request.json().catch(() => ({}));
    const count = Math.min(body.count || 200, 500); // 最多500条
    const generated = await generateMockTickets(count);
    return NextResponse.json({
      success: true,
      data: { generated },
      message: `成功生成 ${generated} 条模拟工单数据`,
    } as ApiResponse<{ generated: number }>);
  } catch (error) {
    console.error("Mock data generation error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "生成模拟数据失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
