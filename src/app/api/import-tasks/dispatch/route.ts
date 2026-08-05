/**
 * POST /api/import-tasks/dispatch - Outbox Dispatcher
 *
 * 职责：
 * 1. 轮询 event_outbox 中 PENDING 事件
 * 2. 调用 Worker 处理对应批次
 * 3. 更新 Outbox 投递状态
 * 4. 失败重试
 */

import { NextResponse } from "next/server";
import {
  fetchPendingOutboxEvents,
  markOutboxSent,
  markOutboxFailed,
  getBatchById,
  getImportTask,
} from "@/lib/db-v4";
import { processBatch } from "@/lib/import-worker";

const MAX_CONCURRENT = 2;
const DISPATCH_TIMEOUT = 50000;

export async function POST() {
  const startTime = Date.now();
  const errors: string[] = [];
  const results: Array<{
    event_id: string;
    batch_index: number;
    success: boolean;
    successCount: number;
    errorCount: number;
    error?: string;
  }> = [];

  try {
    const events = await fetchPendingOutboxEvents(MAX_CONCURRENT);

    if (events.length === 0) {
      return NextResponse.json({ dispatched: 0, message: "无待处理事件" });
    }

    const promises = events.map(async (event) => {
      try {
        const payload = JSON.parse(event.payload);
        const taskId = payload.task_id;
        const batchIndex = payload.batch_index;

        if (Date.now() - startTime > DISPATCH_TIMEOUT) return null;

        await markOutboxSent(event.id);

        let result: { success: boolean; successCount: number; errorCount: number };
        try {
          result = await processBatch({
            task_id: taskId,
            batch_index: batchIndex,
            start_row: payload.start_row,
            end_row: payload.end_row,
            rule_id: payload.rule_id,
            trace_id: payload.trace_id,
          });
        } catch (workerErr) {
          const msg = `Worker异常: ${String(workerErr)}`;
          errors.push(msg);
          console.error(msg);
          return {
            event_id: event.id,
            batch_index: batchIndex,
            success: false,
            successCount: 0,
            errorCount: 0,
            error: msg,
          };
        }

        if (!result.success) {
          // 诊断失败原因
          const batch = await getBatchById(`${taskId}_${batchIndex}`);
          const task = await getImportTask(taskId);
          const reason = `批次状态=${batch?.status ?? 'null'}, 任务状态=${task?.status ?? 'null'}`;
          errors.push(reason);
          return {
            event_id: event.id,
            batch_index: batchIndex,
            success: false,
            successCount: 0,
            errorCount: 0,
            error: reason,
          };
        }

        return {
          event_id: event.id,
          batch_index: batchIndex,
          success: true,
          successCount: result.successCount,
          errorCount: result.errorCount,
        };
      } catch (error) {
        const msg = `Dispatcher异常: ${String(error)}`;
        errors.push(msg);
        console.error(msg);

        if (event.retry_count >= 3) {
          await markOutboxFailed(event.id);
        }

        return {
          event_id: event.id,
          batch_index: 0,
          success: false,
          successCount: 0,
          errorCount: 0,
          error: msg,
        };
      }
    });

    const resolved = (await Promise.all(promises)).filter(Boolean) as NonNullable<(typeof results)[0]>[];
    results.push(...resolved);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return NextResponse.json({
      dispatched: results.length,
      elapsed_seconds: parseFloat(elapsed),
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[Dispatcher] 调度失败:", error);
    return NextResponse.json(
      { error: "调度失败", detail: String(error) },
      { status: 500 }
    );
  }
}
