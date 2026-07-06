// V3 系统配置 API
import { NextRequest, NextResponse } from "next/server";
import { getAllConfig, updateConfig } from "@/lib/db-v3";
import { ApiResponse } from "@/types";

async function ensureInit() {
  try {
    const { initV3DB, initDefaultConfig } = await import("@/lib/db-v3");
    await initV3DB();
    await initDefaultConfig();
  } catch { /* ignore */ }
}

export async function GET() {
  await ensureInit();
  try {
    const config = await getAllConfig();
    return NextResponse.json({ success: true, data: config } as ApiResponse<Record<string, string>>);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "获取配置失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  await ensureInit();
  try {
    const body = await request.json() as Record<string, string>;
    for (const [key, value] of Object.entries(body)) {
      await updateConfig(key, value);
    }
    const config = await getAllConfig();
    return NextResponse.json({
      success: true,
      data: config,
      message: "配置已更新",
    } as ApiResponse<Record<string, string>>);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "更新配置失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
