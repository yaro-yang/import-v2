// POST /api/import-tasks - 上传文件并创建异步导入任务
// 核心要求：1秒内返回 task_id，不等待后台处理完成
// 使用 Transactional Outbox 模式确保任务创建和事件投递的一致性

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  initV4Tables,
  createImportTask,
  createBatch,
  createOutboxEvents,
  insertTraceEvent,
} from "@/lib/db-v4";
import { getRuleById } from "@/lib/db";
import { parseExcel } from "@/lib/file-parser";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const BATCH_SIZE = 1000; // 每批处理 1000 行

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const traceId = `trace_${uuidv4().replace(/-/g, "").slice(0, 12)}`;

  try {
    // 初始化表
    await initV4Tables();

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

    // 保存文件到临时目录
    const uploadDir = path.join(process.cwd(), ".uploads");
    await mkdir(uploadDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${Date.now()}_${file.name}`;
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, buffer);

    // 快速预扫描获取总行数（只读文件结构，不完整解析）
    let totalRows = 0;
    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "";
      if (fileExt === "xlsx" || fileExt === "xls") {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "buffer" });
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 });
          // 减去表头行
          totalRows += Math.max(0, data.length - 1);
        }
      } else {
        // Word/PDF：无法简单预扫描，用默认值
        totalRows = 10000;
      }
    } catch {
      // 预扫描失败，用默认值
      totalRows = 10000;
    }

    const totalBatches = Math.max(1, Math.ceil(totalRows / BATCH_SIZE));

    // 记录 Trace 事件
    await insertTraceEvent({
      trace_id: traceId,
      task_id: "",
      event_name: "FileUploaded",
      message: `文件 ${file.name} 上传成功, ${totalRows} 行, ${totalBatches} 批次`,
    });

    // ============================================================
    // Transactional Outbox：创建任务 + 创建批次 + 写入 Outbox 事件
    // 在同一事务中完成（这里简化实现，后续可改用 db transaction）
    // ============================================================

    // 1. 创建任务
    const task = await createImportTask({
      file_name: file.name,
      file_path: filePath,
      rule_id: ruleId,
      total_rows: totalRows,
      total_batches: totalBatches,
      batch_size: BATCH_SIZE,
      trace_id: traceId,
    });

    // 更新 trace event 的 task_id
    await insertTraceEvent({
      trace_id: traceId,
      task_id: task.id,
      event_name: "ImportTaskCreated",
      message: `任务 ${task.id} 已创建`,
    });

    // 2. 创建批次
    const outboxEvents: Array<{
      aggregate_id: string;
      event_type: string;
      payload: Record<string, unknown>;
    }> = [];

    for (let i = 0; i < totalBatches; i++) {
      const startRow = i * BATCH_SIZE + 1;
      const endRow = Math.min((i + 1) * BATCH_SIZE, totalRows);

      await createBatch(task.id, i, startRow, endRow);

      // 3. 写入 Outbox 事件（同一逻辑事务）
      outboxEvents.push({
        aggregate_id: task.id,
        event_type: "ImportBatchCreated",
        payload: {
          task_id: task.id,
          batch_index: i,
          start_row: startRow,
          end_row: endRow,
          file_path: filePath,
          rule_id: ruleId,
          trace_id: traceId,
        },
      });
    }

    // 批量写入 Outbox
    await createOutboxEvents(outboxEvents);

    await insertTraceEvent({
      trace_id: traceId,
      task_id: task.id,
      event_name: "OutboxEventsCreated",
      message: `${totalBatches} 个批次 Outbox 事件已写入`,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(3);
    console.log(`[import-tasks] 任务 ${task.id} 创建完成, 耗时 ${elapsed}s`);

    return NextResponse.json({
      task_id: task.id,
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
