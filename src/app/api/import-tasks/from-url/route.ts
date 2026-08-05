// POST /api/import-tasks/from-url - 从公开 URL 创建异步导入任务（大文件模式）
// 不存文件内容到 DB，只存 URL，Worker 处理时实时下载
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
    const { fileUrl, ruleId } = await request.json();

    if (!fileUrl || !ruleId) {
      return NextResponse.json({ error: "缺少 fileUrl 或 ruleId" }, { status: 400 });
    }

    const fileName = fileUrl.split("/").pop() || "download.xlsx";
    const db = getSql();

    // 先下载文件头部获取行数（不下载全部数据）
    const headRes = await fetch(fileUrl, {
      headers: { Range: "bytes=0-131071" }, // 128KB 足够读 sheet 元数据
    });
    const headBuf = Buffer.from(await headRes.arrayBuffer());

    let totalRows = 10000; // 默认
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(headBuf, { type: "buffer", sheetRows: 0 });
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (sheet["!ref"]) {
          const range = XLSX.utils.decode_range(sheet["!ref"]);
          totalRows = Math.max(0, range.e.r);
        }
      }
      if (totalRows <= 0) totalRows = 1;
    } catch {
      totalRows = 10000;
    }

    const totalBatches = Math.max(1, Math.ceil(totalRows / BATCH_SIZE));
    const now = new Date().toISOString();

    // 存 fileUrl 而不是 file_data（大文件模式）
    await db`BEGIN`;
    try {
      await db`
        INSERT INTO import_tasks (id, file_name, file_data, rule_id, status, total_rows, processed_rows, success_rows, failed_rows, total_batches, completed_batches, trace_id, degraded, created_at)
        VALUES (${taskId}, ${fileName}, ${null}, ${ruleId}, 'PENDING', ${totalRows}, 0, 0, 0, ${totalBatches}, 0, ${traceId}, FALSE, ${now})
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
          file_url: fileUrl,
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
    console.log(`[import-tasks/from-url] 任务 ${taskId} 创建完成, 耗时 ${elapsed}s`);

    return NextResponse.json({
      task_id: taskId,
      trace_id: traceId,
      status: "PENDING",
      total_rows: totalRows,
      total_batches: totalBatches,
    });
  } catch (error) {
    console.error("[import-tasks/from-url] 创建任务失败:", error);
    return NextResponse.json(
      { error: "创建任务失败", detail: String(error) },
      { status: 500 }
    );
  }
}
