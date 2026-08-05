/**
 * POST /api/import-tasks/dispatch - Outbox Dispatcher
 *
 * 职责：
 * 1. 轮询 event_outbox 中 PENDING 事件
 * 2. 调用 Worker 处理对应批次
 * 3. 更新 Outbox 投递状态
 * 4. 失败重试
 *
 * 在 Vercel Serverless 环境下，此接口通过 Vercel Cron Jobs 定时调用
 * 或在前端轮询时触发（每次任务状态查询时顺便触发一次 dispatch）
 *
 * 对于生产环境，建议部署常驻 Worker 到 Railway/Render 等平台
 */

import { NextResponse } from "next/server";
import {
  fetchPendingOutboxEvents,
  markOutboxSent,
  markOutboxFailed,
} from "@/lib/db-v4";
import { processBatch } from "@/lib/import-worker";

const MAX_CONCURRENT = 2; // Vercel Serverless 限制并发数
const DISPATCH_TIMEOUT = 50000; // 50秒超时（Vercel 免费版 60s 限制）

export async function POST() {
  const startTime = Date.now();
  const results: Array<{
    event_id: string;
    batch_index: number;
    success: boolean;
    successCount: number;
    errorCount: number;
  }> = [];

  try {
    // 1. 获取待投递事件
    const events = await fetchPendingOutboxEvents(MAX_CONCURRENT);

    if (events.length === 0) {
      return NextResponse.json({ dispatched: 0, message: "无待处理事件" });
    }

    // 2. 并发处理
    const promises = events.map(async (event) => {
      try {
        const payload = JSON.parse(event.payload);

        // 投递前检查超时
        if (Date.now() - startTime > DISPATCH_TIMEOUT) {
          return null;
        }

        // 标记为已投递
        await markOutboxSent(event.id);

        // 调用 Worker 处理
        const result = await processBatch({
          task_id: payload.task_id,
          batch_index: payload.batch_index,
          start_row: payload.start_row,
          end_row: payload.end_row,
          file_path: payload.file_path,
          rule_id: payload.rule_id,
          trace_id: payload.trace_id,
        });

        return {
          event_id: event.id,
          batch_index: payload.batch_index,
          success: result.success,
          successCount: result.successCount,
          errorCount: result.errorCount,
        };
      } catch (error) {
        console.error(`[Dispatcher] 处理事件 ${event.id} 失败:`, error);

        // 重试次数过多则标记失败
        if (event.retry_count >= 3) {
          await markOutboxFailed(event.id);
        }

        return {
          event_id: event.id,
          batch_index: 0,
          success: false,
          successCount: 0,
          errorCount: 0,
        };
      }
    });

    const resolved = (await Promise.all(promises)).filter(Boolean) as NonNullable<typeof results[0]>[];
    results.push(...resolved);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return NextResponse.json({
      dispatched: results.length,
      elapsed_seconds: parseFloat(elapsed),
      results,
    });
  } catch (error) {
    console.error("[Dispatcher] 调度失败:", error);
    return NextResponse.json(
      { error: "调度失败", detail: String(error) },
      { status: 500 }
    );
  }
}
