// POST /api/import-tasks - 上传文件并创建异步导入任务
// 核心要求：1秒内返回 task_id，不等待后台处理完成
// 使用 Transactional Outbox 模式确保任务创建和事件投递的一致性
// Vercel Serverless 兼容：文件内容存数据库 BYTEA，不写本地磁盘

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { neon } from "@neondatabase/serverless";
import { getRuleById } from "@/lib/db";

const BATCH_SIZE = 1000; // 每批处理 1000 行

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
    // 解析 multipart form
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const ruleId = formData.get("ruleId") as string;

    if (!file) {
      return NextResponse.json({ error: "请上传文件" }, { status: 400 });
    }
    if (!ruleId) {
      return NextResponse.json({ error: "请指定解析规则" }, { status: 400 });
    }

    // 验证规则存在
    const rule = await getRuleById(ruleId);
    if (!rule) {
      return NextResponse.json({ error: "解析规则不存在" }, { status: 404 });
    }

    // 文件内容读入内存（不写磁盘，Vercel Serverless 兼容）
    const buffer = Buffer.from(await file.arrayBuffer());

    // 快速预扫描获取总行数
    let totalRows = 0;
    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "";
      if (fileExt === "xlsx" || fileExt === "xls") {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "buffer" });
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 });
          totalRows += Math.max(0, data.length - 1);
        }
      } else {
        totalRows = 10000;
      }
    } catch {
      totalRows = 10000;
    }

    const totalBatches = Math.max(1, Math.ceil(totalRows / BATCH_SIZE));

    // ============================================================
    // Transactional Outbox：任务 + 批次 + Outbox 在同一事务中
    // 文件内容以 BYTEA 存入 import_tasks.file_data
    // ============================================================
    const db = getSql();
    const now = new Date().toISOString();

    // 使用原生 SQL 事务保证原子性
    await db`BEGIN`;
    try {
      // 1. 创建任务（file_data 存文件二进制内容）
      await db`
        INSERT INTO import_tasks (id, file_name, file_data, rule_id, status, total_rows, processed_rows, success_rows, failed_rows, total_batches, completed_batches, trace_id, degraded, created_at)
        VALUES (${taskId}, ${file.name}, ${buffer}, ${ruleId}, 'PENDING', ${totalRows}, 0, 0, 0, ${totalBatches}, 0, ${traceId}, FALSE, ${now})
      `;

      // 2. 创建批次 + Outbox 事件（file_path 不再需要，Worker 从 DB 读）
      for (let i = 0; i < totalBatches; i++) {
        const startRow = i * BATCH_SIZE + 1;
        const endRow = Math.min((i + 1) * BATCH_SIZE, totalRows);
        const batchId = `${taskId}_${i}`;

        await db`
          INSERT INTO import_task_batches (id, task_id, batch_index, start_row, end_row, status, retry_count)
          VALUES (${batchId}, ${taskId}, ${i}, ${startRow}, ${endRow}, 'PENDING', 0)
          ON CONFLICT (task_id, batch_index) DO NOTHING
        `;

        // JSON.stringify 预计算为变量，避免 neon 模板字符串吞掉
        const payloadJson = JSON.stringify({
          task_id: taskId,
          batch_index: i,
          start_row: startRow,
          end_row: endRow,
          rule_id: ruleId,
          trace_id: traceId,
          schema_version: "1.0",
        });

        await db`
          INSERT INTO event_outbox (id, aggregate_id, event_type, payload, status, created_at)
          VALUES (${uuidv4()}, ${taskId}, 'ImportBatchCreated', ${payloadJson}, 'PENDING', ${now})
        `;
      }

      // 3. 记录 Trace 事件
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
