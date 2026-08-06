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

const MAX_CONCURRENT = 4;
const DISPATCH_TIMEOUT = 55000;
const MAX_CHAIN_DEPTH = 8; // 链式自触发深度上限，防止无限递归

export async function POST(req: Request) {
  // 支持 ?depth= 链式调用，避免单请求超时导致积压残留
  const url = new URL(req.url);
  const depth = Math.min(parseInt(url.searchParams.get("depth") || "0", 10) || 0, MAX_CHAIN_DEPTH);
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
        // 跳过 payload 不是合法 JSON 的坏事件
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.payload);
        } catch {
          console.warn(`[Dispatcher] 跳过坏事件 ${event.id}，payload 不是合法 JSON`);
          // 直接标记为 FAILED，不再处理
          await markOutboxFailed(event.id);
          return null;
        }

        const taskId = payload.task_id as string;
        const batchIndex = payload.batch_index as number;

        if (Date.now() - startTime > DISPATCH_TIMEOUT) return null;

        await markOutboxSent(event.id);

        let result: { success: boolean; successCount: number; errorCount: number };
        try {
          result = await processBatch({
            task_id: taskId,
            batch_index: batchIndex,
            start_row: payload.start_row as number,
            end_row: payload.end_row as number,
            rule_id: payload.rule_id as string,
            trace_id: payload.trace_id as string,
            file_url: payload.file_url as string | undefined,
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

    // 链式自触发：本批处理完若仍有 PENDING 事件且未超深度，继续下一跳，
    // 避免单请求 55s 超时后积压残留（替代已删除的 Vercel Cron）。
    if (depth < MAX_CHAIN_DEPTH && Date.now() - startTime < DISPATCH_TIMEOUT) {
      const remaining = await fetchPendingOutboxEvents(1);
      if (remaining.length > 0) {
        const base = `${url.origin}${url.pathname}`;
        // 不 await，fire-and-forget，由下一跳继续消费
        fetch(`${base}?depth=${depth + 1}`, { method: "POST" }).catch(() => {});
      }
    }

    return NextResponse.json({
      dispatched: results.length,
      elapsed_seconds: parseFloat(elapsed),
      chain_depth: depth,
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
