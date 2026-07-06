// V3 扫描操作 API
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createScanRecord, getWaybillSnapshot, upsertWaybillSnapshot,
  hasOpenScanTicket, createTicket, getQCRules, updateInventory,
} from "@/lib/db-v3";
import { verifySkuBelongsToWaybill } from "@/lib/v2-client";
import { executeQCEngine, determineExceptionFromMatches } from "@/lib/qc-engine";
import { DEFAULT_CONFIG } from "@/lib/config";
import { ApiResponse, ScanRecord, ExceptionTicket, OutboundOrder } from "@/types";

// 确保 DB 初始化
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
    const { waybillId, skuCode, skuName, batchNo, operator, operatorRole, damageLevel, actualQuantity, specDeviation, labelMatch, batchValid, description } = body;

    if (!waybillId || !skuCode || !operator) {
      return NextResponse.json(
        { success: false, error: "waybillId, skuCode, operator are required" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    // 1. 通过 V2 接口校验 SKU 是否归属该运单（真实性校验）
    const verifyResult = await verifySkuBelongsToWaybill(waybillId, skuCode);
    if (!verifyResult.valid) {
      return NextResponse.json(
        { success: false, error: `SKU "${skuCode}" 不属于运单 ${waybillId}，或运单不存在` } as ApiResponse<null>,
        { status: 400 }
      );
    }

    const v2Waybill = verifyResult.waybill as OutboundOrder;

    // 2. 同步/更新运单本地快照
    let snapshot = await getWaybillSnapshot(waybillId);
    if (!snapshot) {
      snapshot = await upsertWaybillSnapshot({
        waybillId,
        externalCode: v2Waybill.externalCode,
        storeName: v2Waybill.storeName,
        recipientName: v2Waybill.recipientName,
        recipientPhone: v2Waybill.recipientPhone,
        recipientAddress: v2Waybill.recipientAddress,
        totalAmount: 0,
        skuCount: v2Waybill.items?.length || 0,
        rawData: v2Waybill as unknown as Record<string, unknown>,
        syncedAt: new Date().toISOString(),
        dataVersion: 1,
      });
    }

    // 3. 扫描幂等性检查：同一运单+同一SKU+未关闭品控工单
    const openCheck = await hasOpenScanTicket(snapshot.id, skuCode);
    if (openCheck.exists) {
      // 追加扫描记录，但不创建新工单
      await createScanRecord({
        waybillSnapshotId: snapshot.id,
        externalCode: v2Waybill.externalCode,
        skuCode,
        skuName: skuName || verifyResult.waybill?.items?.find((i) => i.skuCode === skuCode)?.skuName,
        batchNo,
        operator,
        qcResult: "fail",
        failReason: "重复扫描（已存在未关闭品控工单）",
        batchStatus: "qc_hold",
        ticketId: openCheck.ticketId,
      });

      return NextResponse.json({
        success: true,
        data: {
          scanResult: "duplicate",
          message: `该批次已存在未关闭品控工单 ${openCheck.ticketNo}，已追加扫描记录`,
          existingTicketId: openCheck.ticketId,
          existingTicketNo: openCheck.ticketNo,
        },
      } as ApiResponse<Record<string, unknown>>);
    }

    // 4. 执行品控规则引擎
    const rules = await getQCRules();
    const qcResult = executeQCEngine(rules, {
      skuCode,
      skuName,
      actualQuantity,
      expectedQuantity: verifyResult.waybill?.items?.find((i) => i.skuCode === skuCode)?.skuQuantity,
      damageLevel,
      specDeviation,
      labelMatch,
      batchValid,
      description,
    });

    const now = new Date().toISOString();

    // 5. 记录扫描结果
    if (qcResult.result === "pass") {
      await createScanRecord({
        waybillSnapshotId: snapshot.id,
        externalCode: v2Waybill.externalCode,
        skuCode,
        skuName,
        batchNo,
        operator,
        qcResult: "pass",
        batchStatus: "normal",
      });

      return NextResponse.json({
        success: true,
        data: {
          scanResult: "pass",
          message: "品控检测通过，正常出库",
          ruleMatches: qcResult.matches.map((m) => ({
            ruleName: m.rule.name,
            reason: m.reason,
            severity: m.severity,
          })),
        },
      } as ApiResponse<Record<string, unknown>>);
    }

    // 6. 品控异常：锁定批次 + 创建工单
    await updateInventory(skuCode, batchNo, {
      lockedDelta: verifyResult.waybill?.items?.find((i) => i.skuCode === skuCode)?.skuQuantity || 1,
      status: "qc_hold",
    });

    // 确定异常类型和最严重等级
    const exceptionInfo = determineExceptionFromMatches(qcResult.matches);
    const exceptionType = exceptionInfo?.exceptionType || "qc_appearance";

    // 创建异常工单（扫描自动触发）
    const ticket = await createTicket({
      waybillSnapshotId: snapshot.id,
      exceptionType,
      exceptionSource: "scan_trigger",
      description: description || qcResult.failReason || "品控检测异常",
      amount: 0,
      reporter: operator,
      reporterRole: operatorRole || "operator",
    });

    // 设置审批超时
    const qcHoldTimeout = DEFAULT_CONFIG.qcHold.timeoutHours;
    const pendingTimeout = DEFAULT_CONFIG.timeout.pendingTimeoutHours;
    const timeoutAt = new Date(Date.now() + qcHoldTimeout * 60 * 60 * 1000).toISOString();

    await createScanRecord({
      waybillSnapshotId: snapshot.id,
      externalCode: v2Waybill.externalCode,
      skuCode,
      skuName,
      batchNo,
      operator,
      qcResult: "fail",
      failReason: qcResult.failReason,
      triggeredRuleId: qcResult.matches[0]?.rule.id,
      triggeredRuleName: qcResult.matches[0]?.rule.name,
      batchStatus: "qc_hold",
      ticketId: ticket.id,
    });

    return NextResponse.json({
      success: true,
      data: {
        scanResult: "fail",
        message: `品控检测异常：${qcResult.failReason}`,
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo,
        ruleMatches: qcResult.matches.map((m) => ({
          ruleId: m.rule.id,
          ruleName: m.rule.name,
          reason: m.reason,
          severity: m.severity,
        })),
        batchStatus: "qc_hold",
        timeoutAt,
      },
    } as ApiResponse<Record<string, unknown>>);
  } catch (error) {
    console.error("Scan error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "扫描失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
