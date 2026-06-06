// POST /api/orders/check-duplicate
// 批量检测外部编码是否在数据库已存在
// 请求体：{ codes: string[] }
// 响应：{ duplicates: { [code: string]: { exists: true; id: string; createdAt: string } } }

import { NextRequest, NextResponse } from "next/server";
import { findExternalCodesInDb } from "@/lib/db";
import { ensureDB } from "@/lib/ensure-db";
import { ApiResponse } from "@/types";

export async function POST(request: NextRequest) {
  await ensureDB();
  try {
    const body = await request.json();
    const { codes } = body as { codes: string[] };

    if (!Array.isArray(codes)) {
      return NextResponse.json(
        { success: false, error: "codes 必须是字符串数组" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    const found = await findExternalCodesInDb(codes);
    const duplicates: Record<string, { exists: true; id: string; createdAt: string }> = {};
    for (const [code, info] of found.entries()) {
      duplicates[code] = { exists: true, ...info };
    }

    return NextResponse.json({
      success: true,
      data: { duplicates },
    } as ApiResponse<{ duplicates: Record<string, { exists: true; id: string; createdAt: string }> }>);
  } catch (error) {
    console.error("Check duplicate error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "检测失败",
      } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
