// V3 工单 API - 列表 & 创建
import { NextRequest, NextResponse } from "next/server";
import {
  createTicket, getTickets, getWaybillSnapshot, upsertWaybillSnapshot,
} from "@/lib/db-v3";
import { getWaybillDetail, getWaybillByExternalCode } from "@/lib/v2-client";
import { ApiResponse, ExceptionType, ExceptionSource, OutboundOrder } from "@/types";

async function ensureInit() {
  try {
    const { initV3DB, initDefaultConfig } = await import("@/lib/db-v3");
    await initV3DB();
    await initDefaultConfig();
  } catch { /* ignore */ }
}

export async function GET(request: NextRequest) {
  await ensureInit();

  try {
    const { searchParams } = new URL(request.url);
    const tickets = await getTickets({
      status: searchParams.get("status") as ExceptionTicket["status"] || undefined,
      exceptionType: searchParams.get("exceptionType") as ExceptionType || undefined,
      waybillCode: searchParams.get("waybillCode") || undefined,
      reporter: searchParams.get("reporter") || undefined,
      page: parseInt(searchParams.get("page") || "1"),
      pageSize: parseInt(searchParams.get("pageSize") || "20"),
    });

    return NextResponse.json({ success: true, data: tickets } as ApiResponse<typeof tickets>);
  } catch (error) {
    console.error("Get tickets error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "获取工单失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  await ensureInit();

  try {
    const body = await request.json();
    const { waybillId, externalCode, exceptionType, description, amount, reporter, reporterRole } = body;

    if (!exceptionType || !description || !reporter) {
      return NextResponse.json(
        { success: false, error: "exceptionType, description, reporter are required" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    // 1. 通过 V2 接口校验运单存在性（真实接口校验，不仅仅是本地快照）
    let v2Waybill: OutboundOrder | null = null;
    let snapshot: Awaited<ReturnType<typeof getWaybillSnapshot>> = null;

    // 优先用 waybillId 查询
    if (waybillId) {
      const result = await getWaybillDetail(waybillId);
      if (result.error) {
        return NextResponse.json(
          { success: false, error: `V2 接口校验失败：${result.error}` } as ApiResponse<null>,
          { status: 502 }
        );
      }
      v2Waybill = result.waybill;
    } else if (externalCode) {
      const result = await getWaybillByExternalCode(externalCode);
      if (result.error) {
        return NextResponse.json(
          { success: false, error: `V2 接口校验失败：${result.error}` } as ApiResponse<null>,
          { status: 502 }
        );
      }
      if (result.waybills.length === 0) {
        return NextResponse.json(
          { success: false, error: `运单号 ${externalCode} 不存在` } as ApiResponse<null>,
          { status: 404 }
        );
      }
      v2Waybill = result.waybills[0];
    } else {
      return NextResponse.json(
        { success: false, error: "waybillId or externalCode is required" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    if (!v2Waybill) {
      return NextResponse.json(
        { success: false, error: "运单不存在，无法发起异常上报" } as ApiResponse<null>,
        { status: 404 }
      );
    }

    // 2. 同步/更新运单本地快照
    snapshot = await getWaybillSnapshot(v2Waybill.id);
    if (!snapshot) {
      snapshot = await upsertWaybillSnapshot({
        waybillId: v2Waybill.id,
        externalCode: v2Waybill.externalCode,
        storeName: v2Waybill.storeName,
        recipientName: v2Waybill.recipientName,
        recipientPhone: v2Waybill.recipientPhone,
        recipientAddress: v2Waybill.recipientAddress,
        totalAmount: amount || 0,
        skuCount: v2Waybill.items?.length || 0,
        rawData: v2Waybill as unknown as Record<string, unknown>,
        syncedAt: new Date().toISOString(),
        dataVersion: 1,
      });
    }

    // 3. 查重：同一运单+同类型+未关闭工单
    const existingTickets = await getTickets({
      waybillCode: v2Waybill.externalCode,
    });
    const duplicate = existingTickets.tickets.find(
      (t) =>
        t.exceptionType === exceptionType &&
        !["completed", "rejected_final"].includes(t.status)
    );
    if (duplicate) {
      return NextResponse.json(
        {
          success: false,
          error: `该运单已存在同类型未关闭工单：${duplicate.ticketNo}（状态：${duplicate.status}）`,
        } as ApiResponse<null>,
        { status: 409 }
      );
    }

    // 4. 创建工单
    const ticket = await createTicket({
      waybillSnapshotId: snapshot.id,
      exceptionType,
      exceptionSource: "manual" as ExceptionSource,
      description,
      amount: amount || v2Waybill.items?.reduce((sum, i) => sum + i.skuQuantity, 0) || 0,
      reporter,
      reporterRole: reporterRole || "operator",
    });

    return NextResponse.json({
      success: true,
      data: ticket,
      message: `工单 ${ticket.ticketNo} 创建成功`,
    } as ApiResponse<typeof ticket>);
  } catch (error) {
    console.error("Create ticket error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "创建工单失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
