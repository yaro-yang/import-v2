// V3 超时自动流转 - 定时检查超时工单并自动升级/驳回
import { NextResponse } from "next/server";
import { getTickets, updateTicketStatus, createApprovalRecord, getAllConfig } from "@/lib/db-v3";
import { DEFAULT_CONFIG } from "@/lib/config";
import { ApiResponse, TicketStatus } from "@/types";

export async function GET() {
  try {
    const { initV3DB, initDefaultConfig } = await import("@/lib/db-v3");
    await initV3DB();
    await initDefaultConfig();
  } catch { /* ignore */ }

  const config = await getAllConfig();
  const pendingTimeout = Number(config.pending_timeout_hours || DEFAULT_CONFIG.timeout.pendingTimeoutHours);
  const l1Timeout = Number(config.level1_timeout_hours || DEFAULT_CONFIG.timeout.level1ReviewHours);
  const l2Timeout = Number(config.level2_timeout_hours || DEFAULT_CONFIG.timeout.level2ReviewHours);
  const qcHoldTimeout = Number(config.qc_hold_timeout_hours || DEFAULT_CONFIG.qcHold.timeoutHours);

  const now = Date.now();
  const results: string[] = [];

  // 检查待审批超时 → 升级到二级审批
  const pendingTickets = await getTickets({ status: "pending", pageSize: 500 });
  for (const t of pendingTickets.tickets) {
    const age = (now - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
    // 品控暂扣超时（更短）→ 强制升级二级审批
    if (t.exceptionSource === "scan_trigger" && age >= qcHoldTimeout) {
      const r = await updateTicketStatus(t.id, "level2_review", 2, t.version, {
        timeoutAt: new Date(now + l2Timeout * 60 * 60 * 1000).toISOString(),
      });
      if (r.success) {
        await createApprovalRecord({
          ticketId: t.id, ticketNo: t.ticketNo, approver: "system",
          approverRole: "system", level: 2, action: "escalate",
          opinion: `品控暂扣超时（${qcHoldTimeout}h），自动升级二级审批`,
          triggeredBy: "auto_timeout",
        });
        results.push(`${t.ticketNo}: 品控暂扣超时 → 二级审批`);
      }
    } else if (age >= pendingTimeout) {
      const r = await updateTicketStatus(t.id, "level2_review", 2, t.version, {
        timeoutAt: new Date(now + l2Timeout * 60 * 60 * 1000).toISOString(),
      });
      if (r.success) {
        await createApprovalRecord({
          ticketId: t.id, ticketNo: t.ticketNo, approver: "system",
          approverRole: "system", level: 2, action: "escalate",
          opinion: `待审批超时（${pendingTimeout}h），自动升级二级审批`,
          triggeredBy: "auto_timeout",
        });
        results.push(`${t.ticketNo}: 待审批超时 → 二级审批`);
      }
    }
  }

  // 检查一级审批超时 → 升级到二级审批
  const l1Tickets = await getTickets({ status: "level1_review", pageSize: 500 });
  for (const t of l1Tickets.tickets) {
    const age = (now - new Date(t.updatedAt).getTime()) / (1000 * 60 * 60);
    if (age >= l1Timeout) {
      const r = await updateTicketStatus(t.id, "level2_review", 2, t.version, {
        timeoutAt: new Date(now + l2Timeout * 60 * 60 * 1000).toISOString(),
      });
      if (r.success) {
        await createApprovalRecord({
          ticketId: t.id, ticketNo: t.ticketNo, approver: "system",
          approverRole: "system", level: 2, action: "escalate",
          opinion: `一级审批超时（${l1Timeout}h），自动升级二级审批`,
          triggeredBy: "auto_timeout",
        });
        results.push(`${t.ticketNo}: 一级审批超时 → 二级审批`);
      }
    }
  }

  // 检查二级审批超时 → 自动驳回
  const l2Tickets = await getTickets({ status: "level2_review", pageSize: 500 });
  for (const t of l2Tickets.tickets) {
    const age = (now - new Date(t.updatedAt).getTime()) / (1000 * 60 * 60);
    if (age >= l2Timeout) {
      const r = await updateTicketStatus(t.id, "rejected_final", 2, t.version);
      if (r.success) {
        await createApprovalRecord({
          ticketId: t.id, ticketNo: t.ticketNo, approver: "system",
          approverRole: "system", level: 2, action: "reject",
          opinion: `二级审批超时（${l2Timeout}h），自动驳回`,
          triggeredBy: "auto_timeout",
        });
        results.push(`${t.ticketNo}: 二级审批超时 → 自动驳回`);
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: { processed: results.length, results },
    message: results.length > 0 ? `处理了 ${results.length} 条超时工单` : "暂无超时工单",
  } as ApiResponse<Record<string, unknown>>);
}
