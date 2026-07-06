// V3 快速放行 API（品控主管专用）
import { NextRequest, NextResponse } from "next/server";
import { getTicketById, updateTicketStatus, createScanRecord, updateInventory, getScanRecords } from "@/lib/db-v3";
import { ApiResponse, TicketStatus } from "@/types";

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
    const body = await request.json();
    const { ticketId, operator, operatorRole, reason } = body;

    // 权限校验：仅品控主管可操作
    if (operatorRole !== "qc_supervisor" && operatorRole !== "admin") {
      return NextResponse.json(
        { success: false, error: "仅品控主管可执行快速放行操作" } as ApiResponse<null>,
        { status: 403 }
      );
    }

    if (!ticketId || !operator || !reason) {
      return NextResponse.json(
        { success: false, error: "ticketId, operator, reason are required" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return NextResponse.json(
        { success: false, error: "工单不存在" } as ApiResponse<null>,
        { status: 404 }
      );
    }

    if (!["pending", "level1_review", "level2_review"].includes(ticket.status)) {
      return NextResponse.json(
        { success: false, error: "工单当前状态不允许快速放行" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    if (ticket.exceptionSource !== "scan_trigger") {
      return NextResponse.json(
        { success: false, error: "仅品控异常工单支持快速放行" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    // 更新工单状态为已完成
    const result = await updateTicketStatus(ticketId, "completed", ticket.currentLevel, ticket.version);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "操作失败" } as ApiResponse<null>,
        { status: 409 }
      );
    }

    // 解锁批次（库存层面）
    if (ticket.waybillSnapshotId) {
      try {
        const scans = await getScanRecords(ticket.waybillSnapshotId);
        for (const scan of scans) {
          if (scan.qcResult === "fail" && scan.ticketId === ticketId) {
            await updateInventory(scan.skuCode, scan.batchNo, {
              lockedDelta: -1,
              status: "available",
            });
          }
        }
      } catch (e) {
        console.error("Unlock batch error:", e);
      }
    }

    return NextResponse.json({
      success: true,
      data: { ticketId, newStatus: "completed" },
      message: `工单 ${ticket.ticketNo} 已快速放行（品控主管：${operator}，原因：${reason}）`,
    } as ApiResponse<Record<string, unknown>>);
  } catch (error) {
    console.error("Fast release error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "快速放行失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
