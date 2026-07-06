// V3 同步监控 API
import { NextResponse } from "next/server";
import { getSyncStats } from "@/lib/db-v3";
import { checkV2Health } from "@/lib/v2-client";
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
    const stats = await getSyncStats();
    const health = await checkV2Health();
    return NextResponse.json({
      success: true,
      data: { ...stats, v2Healthy: health.healthy, v2Latency: health.latency },
    } as ApiResponse<Record<string, unknown>>);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "获取监控数据失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
