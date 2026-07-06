// V2 外部接口 - 健康检查
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey !== "v3-system-api-key-2024") {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    data: { status: "healthy", timestamp: new Date().toISOString() },
  });
}
