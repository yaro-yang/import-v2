// V3 品控规则配置 API
import { NextRequest, NextResponse } from "next/server";
import { getQCRules, saveQCRule, deleteQCRule } from "@/lib/db-v3";
import { v4 as uuidv4 } from "uuid";
import { ApiResponse, QCRule } from "@/types";

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
    const rules = await getQCRules();
    return NextResponse.json({ success: true, data: rules } as ApiResponse<QCRule[]>);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "获取规则失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  await ensureInit();
  try {
    const body = await request.json() as Partial<QCRule>;
    const rule = await saveQCRule({
      ...(body.id ? { id: body.id } : {}),
      name: body.name || "新规则",
      exceptionSubType: body.exceptionSubType || "qc_appearance",
      conditionField: body.conditionField || "damage_level",
      conditionOperator: body.conditionOperator || "gte",
      conditionValue: body.conditionValue || "1",
      severity: body.severity || "medium",
      autoCreateTicket: body.autoCreateTicket !== false,
      approvalLevel: body.approvalLevel || 1,
      enabled: body.enabled !== false,
      priority: body.priority || 0,
    });
    return NextResponse.json({ success: true, data: rule } as ApiResponse<QCRule>);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "保存规则失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  await ensureInit();
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" } as ApiResponse<null>,
        { status: 400 }
      );
    }
    await deleteQCRule(id);
    return NextResponse.json({ success: true, message: "规则已删除" } as ApiResponse<null>);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "删除规则失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
