// V3 审批 API
import { NextRequest, NextResponse } from "next/server";
import {
  getTicketById, updateTicketStatus, createApprovalRecord,
  createCompensationRecord, updateInventory, getAllConfig,
} from "@/lib/db-v3";
import { DEFAULT_CONFIG } from "@/lib/config";
import { ApiResponse, ExceptionTicket, ApprovalAction, TicketStatus, ExecutionAction } from "@/types";

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
    const { ticketId, approver, approverRole, action, opinion, triggeredBy } = body;

    if (!ticketId || !approver || !action) {
      return NextResponse.json(
        { success: false, error: "ticketId, approver, action are required" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    // 1. 获取工单
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return NextResponse.json(
        { success: false, error: "工单不存在" } as ApiResponse<null>,
        { status: 404 }
      );
    }

    // 2. 权限校验：上报人不能审批自己的工单
    if (ticket.reporter === approver) {
      return NextResponse.json(
        { success: false, error: "不能审批自己上报的工单" } as ApiResponse<null>,
        { status: 403 }
      );
    }

    // 3. 权限校验：非对应层级/角色不能审批
    const allowedStatuses: TicketStatus[] = action === "reject"
      ? ["level1_review", "level2_review"]
      : ticket.status === "pending" ? ["pending"] : ticket.status === "level1_review" ? ["level1_review"] : ticket.status === "level2_review" ? ["level2_review"] : [];

    if (!allowedStatuses.includes(ticket.status)) {
      return NextResponse.json(
        { success: false, error: `工单当前状态(${ticket.status})不允许审批操作` } as ApiResponse<null>,
        { status: 400 }
      );
    }

    // 4. 并发冲突检查：使用版本号乐观锁
    const config = await getAllConfig();
    const level2Threshold = Number(config.level2_threshold || DEFAULT_CONFIG.approval.level2Threshold);
    const maxRejectCount = Number(config.max_reject_count || DEFAULT_CONFIG.resubmit.maxRejectCount);

    let newStatus: TicketStatus;
    let newLevel: number;
    let executionAction: ExecutionAction | undefined;

    if (action === "reject") {
      const newRejectCount = ticket.rejectCount + 1;
      if (newRejectCount >= maxRejectCount) {
        newStatus = "rejected_final";
        newLevel = ticket.currentLevel;
      } else {
        newStatus = "pending";
        newLevel = 0;
      }
    } else if (action === "approve") {
      const currentLevel = ticket.currentLevel || 1;
      
      // 一级审批通过后判断是否需要二级审批
      if (ticket.status === "pending") {
        if (ticket.amount > level2Threshold || ticket.exceptionSource === "scan_trigger") {
          // 进入二级审批
          newStatus = "level2_review";
          newLevel = 2;
        } else {
          // 直接进入执行
          newStatus = "executing";
          newLevel = 1;
        }
      } else if (ticket.status === "level1_review") {
        newStatus = "executing";
        newLevel = 1;
        // 确定执行动作
        executionAction = determineExecutionAction(ticket.exceptionType, ticket.exceptionSource);
      } else if (ticket.status === "level2_review") {
        newStatus = "executing";
        newLevel = 2;
        executionAction = determineExecutionAction(ticket.exceptionType, ticket.exceptionSource);
      } else {
        return NextResponse.json(
          { success: false, error: `当前状态(${ticket.status})不允许审批操作` } as ApiResponse<null>,
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { success: false, error: `不支持的审批动作: ${action}` } as ApiResponse<null>,
        { status: 400 }
      );
    }

    // 5. 更新工单状态（乐观锁）
    const extra: Record<string, unknown> = {};
    if (action === "reject") {
      extra.rejectCount = ticket.rejectCount + 1;
    }
    if (executionAction) {
      extra.executionAction = executionAction;
    }

    const updateResult = await updateTicketStatus(
      ticketId,
      newStatus,
      newLevel,
      ticket.version,
      extra as { rejectCount?: number; executionAction?: ExecutionAction }
    );

    if (!updateResult.success) {
      return NextResponse.json(
        { success: false, error: updateResult.error || "该工单已被处理，请刷新" } as ApiResponse<null>,
        { status: 409 }
      );
    }

    // 6. 创建审批记录
    const approvalLevel = ticket.currentLevel || (ticket.status === "pending" ? 1 : ticket.status === "level2_review" ? 2 : 1);
    const approvalRecord = await createApprovalRecord({
      ticketId,
      ticketNo: ticket.ticketNo,
      approver,
      approverRole: approverRole || "",
      level: approvalLevel,
      action: action as ApprovalAction,
      opinion,
      triggeredBy: (triggeredBy as "manual" | "auto_timeout" | "auto_escalation") || "manual",
    });

    // 7. 如果审批通过进入执行阶段，触发执行联动
    if (action === "approve" && newStatus === "executing") {
      await executeLinkedActions(ticket, approvalRecord.id);
    }

    return NextResponse.json({
      success: true,
      data: {
        ticketId,
        newStatus,
        newLevel,
        approvalRecordId: approvalRecord.id,
        executionAction,
      },
      message: action === "approve" ? "审批通过" : `审批拒绝（剩余重提次数：${maxRejectCount - (ticket.rejectCount + 1)}）`,
    } as ApiResponse<Record<string, unknown>>);
  } catch (error) {
    console.error("Approval error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "审批操作失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}

// 确定执行动作
function determineExecutionAction(exceptionType: string, exceptionSource: string): ExecutionAction {
  const mapping = DEFAULT_CONFIG.exceptionActionMapping[exceptionType as keyof typeof DEFAULT_CONFIG.exceptionActionMapping];
  if (mapping && mapping.actions.length > 0) {
    return mapping.actions[0] as ExecutionAction;
  }
  return exceptionSource === "scan_trigger" ? "return_supplier" : "claim";
}

// 执行联动操作（审批→赔付+库存变更）
async function executeLinkedActions(ticket: ExceptionTicket, approvalRecordId: string): Promise<void> {
  const exceptionType = ticket.exceptionType;
  const mapping = DEFAULT_CONFIG.exceptionActionMapping[exceptionType as keyof typeof DEFAULT_CONFIG.exceptionActionMapping];

  if (!mapping) return;

  // 生成赔付记录（如果需要）
  if (mapping.hasCompensation && mapping.compensationDirection) {
    try {
      await createCompensationRecord({
        ticketId: ticket.id,
        approvalRecordId,
        compensationDirection: mapping.compensationDirection,
        amount: ticket.amount,
        description: mapping.description,
      });
    } catch (e) {
      console.error("Compensation creation error:", e);
    }
  }

  // 库存联动（如果有库存影响）
  if (mapping.inventoryImpact) {
    try {
      // 从扫描记录获取 SKU 信息
      const { getScanRecords } = await import("@/lib/db-v3");
      if (ticket.waybillSnapshotId) {
        const scans = await getScanRecords(ticket.waybillSnapshotId);
        for (const scan of scans) {
          if (scan.qcResult === "fail") {
            if (mapping.inventoryImpact === "decrease") {
              await updateInventory(scan.skuCode, scan.batchNo, {
                quantityDelta: -1,
                lockedDelta: -1,
                status: "available",
              });
            } else if (mapping.inventoryImpact === "increase") {
              await updateInventory(scan.skuCode, scan.batchNo, {
                quantityDelta: 1,
                status: "available",
              });
            }
          }
        }
      }
    } catch (e) {
      console.error("Inventory update error:", e);
    }
  }

  // 工单执行完成后更新为已完成
  try {
    await updateTicketStatus(ticket.id, "completed", ticket.currentLevel, ticket.version + 1);
  } catch (e) {
    console.error("Complete ticket error:", e);
  }
}

// 其他审批相关操作
export async function GET(request: NextRequest) {
  await ensureInit();

  try {
    const { searchParams } = new URL(request.url);
    const ticketId = searchParams.get("ticketId");
    
    if (ticketId) {
      const ticket = await getTicketById(ticketId);
      if (!ticket) {
        return NextResponse.json(
          { success: false, error: "工单不存在" } as ApiResponse<null>,
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        data: {
          ticket: { id: ticket.id, ticketNo: ticket.ticketNo, status: ticket.status, currentLevel: ticket.currentLevel, version: ticket.version },
          approvalRecords: ticket.approvalRecords,
        },
      } as ApiResponse<Record<string, unknown>>);
    }

    return NextResponse.json(
      { success: false, error: "ticketId is required" } as ApiResponse<null>,
      { status: 400 }
    );
  } catch (error) {
    console.error("Approval get error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "获取审批信息失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
