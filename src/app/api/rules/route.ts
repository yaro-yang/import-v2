import { NextRequest, NextResponse } from "next/server";
import { saveRule, getRules, getRuleById, deleteRule } from "@/lib/db";
import { ensureDB } from "@/lib/ensure-db";
import { ApiResponse, ParseRule } from "@/types";

export async function GET() {
  await ensureDB();
  try {
    const rules = await getRules();
    return NextResponse.json({
      success: true,
      data: rules,
    } as ApiResponse<ParseRule[]>);
  } catch (error) {
    console.error("Get rules error:", error);
    return NextResponse.json(
      { success: false, error: "获取规则列表失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  await ensureDB();
  try {
    const body = await request.json();
    const rule = body as ParseRule;

    if (!rule.name || !rule.fieldMappings) {
      return NextResponse.json(
        { success: false, error: "规则名称和字段映射为必填项" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    const savedRule = await saveRule(rule);
    return NextResponse.json({
      success: true,
      data: savedRule,
      message: "规则保存成功",
    } as ApiResponse<ParseRule>);
  } catch (error) {
    console.error("Save rule error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `保存规则失败: ${detail}` } as ApiResponse<null>,
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  await ensureDB();
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "缺少规则ID" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    const deleted = await deleteRule(id);
    return NextResponse.json({
      success: deleted,
      message: deleted ? "规则已删除" : "规则不存在",
    } as ApiResponse<null>);
  } catch (error) {
    console.error("Delete rule error:", error);
    return NextResponse.json(
      { success: false, error: "删除规则失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
