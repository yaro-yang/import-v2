// POST /api/import-tasks - 上传文件并创建异步导入任务
// 核心要求：1秒内返回 task_id，不等待后台处理完成
// 使用 Transactional Outbox 模式确保任务创建和事件投递的一致性
// Vercel Serverless 兼容：文件内容存数据库 BYTEA，不写本地磁盘
// 支持 fileUrl 参数：绕过 Vercel 请求体大小限制（大文件从公开 URL 下载）
// 性能优化：跳过预扫描行数（Worker 实际处理时自行解析），上传接口只做最小必要工作

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { neon } from "@neondatabase/serverless";

const BATCH_SIZE = 1000;

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("数据库连接未配置");
  return neon(url);
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const traceId = `trace_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
  const taskId = `task_${uuidv4().replace(/-/g, "").slice(0, 12)}`;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const fileUrl = formData.get("fileUrl") as string;
    const ruleId = formData.get("ruleId") as string;

    if (!file && !fileUrl) {
      return NextResponse.json({ error: "请上传文件或提供 fileUrl" }, { status: 400 });
    }
    if (!ruleId) {
      return NextResponse.json({ error: "请指定解析规则" }, { status: 400 });
    }

    // 文件读入内存
    let buffer: Buffer;
    let fileName: string;
    if (file) {
      buffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
    } else {
      const res = await fetch(fileUrl);
      if (!res.ok) {
        return NextResponse.json({ error: `下载文件失败: ${res.status}` }, { status: 400 });
      }
      buffer = Buffer.from(await res.arrayBuffer());
      fileName = fileUrl.split("/").pop() || "download.xlsx";
    }

    // 去重：同一文件 + 同一规则，30 秒内重复上传返回已有任务
    const db = getSql();
    const existingTask = await db(
      `SELECT id, status, trace_id, total_rows, total_batches
       FROM import_tasks
       WHERE file_name = $1 AND rule_id = $2
         AND created_at > NOW() - INTERVAL '30 seconds'
         AND status IN ('PENDING', 'PROCESSING')
       ORDER BY created_at DESC LIMIT 1`,
      [fileName, ruleId]
    );
    if (existingTask.length > 0) {
      return NextResponse.json({
        task_id: existingTask[0].id,
        trace_id: existingTask[0].trace_id,
        status: existingTask[0].status,
        total_rows: existingTask[0].total_rows,
        total_batches: existingTask[0].total_batches,
        dedup: true,
      });
    }

    // 不预扫描行数（省 XLSX 解析开销，P95 < 1s），Worker 自行修正
    const totalRows = 10000;
    const totalBatches = Math.max(1, Math.ceil(totalRows / BATCH_SIZE));
    const now = new Date().toISOString();

    // Transactional Outbox
    await db`BEGIN`;
    try {
      await db`
        INSERT INTO import_tasks (id, file_name, file_data, rule_id, status, total_rows, processed_rows, success_rows, failed_rows, total_batches, completed_batches, trace_id, degraded, created_at)
        VALUES (${taskId}, ${fileName}, ${buffer}, ${ruleId}, 'PENDING', ${totalRows}, 0, 0, 0, ${totalBatches}, 0, ${traceId}, FALSE, ${now})
      `;

      for (let i = 0; i < totalBatches; i++) {
        const startRow = i * BATCH_SIZE + 1;
        const endRow = Math.min((i + 1) * BATCH_SIZE, totalRows);
        const batchId = `${taskId}_${i}`;

        await db`
          INSERT INTO import_task_batches (id, task_id, batch_index, start_row, end_row, status, retry_count)
          VALUES (${batchId}, ${taskId}, ${i}, ${startRow}, ${endRow}, 'PENDING', 0)
          ON CONFLICT (task_id, batch_index) DO NOTHING
        `;

        const payloadJson = JSON.stringify({
          task_id: taskId,
          batch_index: i,
          start_row: startRow,
          end_row: endRow,
          rule_id: ruleId,
          trace_id: traceId,
          schema_version: "1.0",
        });

        await db(
          `INSERT INTO event_outbox (id, aggregate_id, event_type, payload, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), taskId, "ImportBatchCreated", payloadJson, "PENDING", now]
        );
      }

      await db`
        INSERT INTO trace_events (id, trace_id, task_id, event_name, event_status, message, occurred_at)
        VALUES (${uuidv4()}, ${traceId}, ${taskId}, 'ImportTaskCreated', 'OK', ${`任务 ${taskId} 已创建, ${totalRows} 行, ${totalBatches} 批次`}, ${now})
      `;

      await db`COMMIT`;
    } catch (error) {
      await db`ROLLBACK`;
      throw error;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(3);
    console.log(`[import-tasks] 任务 ${taskId} 创建完成, 耗时 ${elapsed}s`);

    return NextResponse.json({
      task_id: taskId,
      trace_id: traceId,
      status: "PENDING",
      total_rows: totalRows,
      total_batches: totalBatches,
    });
  } catch (error) {
    console.error("[import-tasks] 创建任务失败:", error);
    return NextResponse.json(
      { error: "创建任务失败", detail: String(error) },
      { status: 500 }
    );
  }
}
