import { NextRequest } from "next/server";
import { parseExcel, parseWord, parsePDF, detectFileType } from "@/lib/file-parser";
import { executeRule, excelToRawData } from "@/lib/rule-engine";
import { getRuleById } from "@/lib/db";
import { ensureDB } from "@/lib/ensure-db";
import { ParseResult, OrderItem } from "@/types";

// SSE 事件类型
type ParseEvent =
  | { type: "start"; total: number; message: string }
  | { type: "progress"; processed: number; total: number; message?: string }
  | { type: "done"; result: ParseResult }
  | { type: "error"; code: string; message: string; fileInfo: { name: string; size: number; type: string } };

// 文件大小限制（与服务端 body 解析一致）
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  await ensureDB();
  const parseStart = performance.now();
  const encoder = new TextEncoder();

  // 立即创建 SSE 流 - 即使后续失败，也能把错误推给客户端
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ParseEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch (e) {
          // 流已关闭，忽略
        }
      };

      // 包装 controller.close，幂等
      let closed = false;
      const safeClose = () => {
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* ignore */ }
        }
      };

      try {
        // 1. 解析 formData
        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        const ruleId = formData.get("ruleId") as string | null;

        // 2. 参数校验
        if (!file) {
          send({ type: "error", code: "NO_FILE", message: "未上传文件", fileInfo: { name: "", size: 0, type: "" } });
          safeClose();
          return;
        }
        if (!ruleId) {
          send({ type: "error", code: "NO_RULE", message: "未选择解析规则", fileInfo: { name: file.name, size: file.size, type: file.type } });
          safeClose();
          return;
        }
        if (file.size === 0) {
          send({ type: "error", code: "EMPTY_FILE", message: "文件为空，请检查文件内容", fileInfo: { name: file.name, size: file.size, type: file.type } });
          safeClose();
          return;
        }
        if (file.size > MAX_FILE_SIZE) {
          send({ type: "error", code: "FILE_TOO_LARGE", message: `文件超过 ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)}MB 限制`, fileInfo: { name: file.name, size: file.size, type: file.type } });
          safeClose();
          return;
        }

        // 3. 校验规则
        const rule = await getRuleById(ruleId);
        if (!rule) {
          send({ type: "error", code: "RULE_NOT_FOUND", message: "解析规则不存在或已被删除", fileInfo: { name: file.name, size: file.size, type: file.type } });
          safeClose();
          return;
        }

        // 4. 检测文件类型
        const fileType = detectFileType(file.name);
        if (fileType === "unknown") {
          send({
            type: "error",
            code: "UNSUPPORTED_FORMAT",
            message: `不支持的文件格式 "${file.name}"，仅支持 .xlsx/.xls/.docx/.pdf`,
            fileInfo: { name: file.name, size: file.size, type: file.type },
          });
          safeClose();
          return;
        }

        // 5. 读取文件内容
        let buffer: ArrayBuffer;
        try {
          buffer = await file.arrayBuffer();
        } catch (e) {
          send({ type: "error", code: "READ_FAILED", message: `读取文件失败：${e instanceof Error ? e.message : "未知错误"}`, fileInfo: { name: file.name, size: file.size, type: file.type } });
          safeClose();
          return;
        }

        let orders: OrderItem[] = [];

        // 6. 按类型解析 + 进度推送
        if (fileType === "excel") {
          let sheets: Record<string, (string | number | null)[][]>;
          let sheetNames: string[];
          try {
            const result = await parseExcel(buffer);
            sheets = result.sheets;
            sheetNames = result.sheetNames;
          } catch (e) {
            send({
              type: "error",
              code: "EXCEL_PARSE_FAILED",
              message: `Excel 解析失败：${e instanceof Error ? e.message : "文件可能已损坏或被加密"}`,
              fileInfo: { name: file.name, size: file.size, type: file.type },
            });
            safeClose();
            return;
          }

          if (sheetNames.length === 0) {
            send({ type: "error", code: "NO_SHEETS", message: "Excel 文件不包含任何工作表", fileInfo: { name: file.name, size: file.size, type: file.type } });
            safeClose();
            return;
          }

          // 计算总行数
          const sheetNamesToProcess = rule.globalConfig.mergeSheets
            ? Object.keys(sheets)
            : (rule.dataRegion.sheetNames || Object.keys(sheets));
          let totalRows = 0;
          for (const name of sheetNamesToProcess) {
            totalRows += sheets[name]?.length || 0;
          }
          if (totalRows === 0) {
            send({ type: "error", code: "EMPTY_SHEET", message: "所有工作表均为空", fileInfo: { name: file.name, size: file.size, type: file.type } });
            safeClose();
            return;
          }
          send({ type: "start", total: totalRows, message: `共 ${totalRows} 行 ${sheetNamesToProcess.length} 个工作表` });

          // 逐个 sheet 解析
          for (const sheetName of sheetNamesToProcess) {
            const sheetData = sheets[sheetName];
            if (!sheetData) continue;
            try {
              const rawData = excelToRawData(sheetData, rule);
              // 进度回调节流：每 10 行或进度变化 >5% 才推送，避免高频 SSE 写入撑爆流缓冲
              let lastSentRatio = -1;
              const result = await executeRule(rawData, rule, file.name, (processed, total, msg) => {
                const ratio = total > 0 ? Math.floor((processed / total) * 20) : -1; // 5% 粒度
                if (ratio !== lastSentRatio) {
                  lastSentRatio = ratio;
                  send({ type: "progress", processed, total, message: `[${sheetName}] ${msg || ""}` });
                }
              });
              for (const order of result.orders) {
                order.sourceSheet = sheetName;
              }
              orders.push(...result.orders);
            } catch (e) {
              send({
                type: "error",
                code: "RULE_EXEC_FAILED",
                message: `工作表「${sheetName}」解析失败：${e instanceof Error ? e.message : "未知错误"}，请检查解析规则`,
                fileInfo: { name: file.name, size: file.size, type: file.type },
              });
              safeClose();
              return;
            }
          }
        } else if (fileType === "word") {
          let text: string;
          try {
            text = await parseWord(buffer);
          } catch (e) {
            send({
              type: "error",
              code: "WORD_PARSE_FAILED",
              message: `Word 解析失败：${e instanceof Error ? e.message : "文件可能已损坏、加密或包含不可读内容"}`,
              fileInfo: { name: file.name, size: file.size, type: file.type },
            });
            safeClose();
            return;
          }
          if (!text || !text.trim()) {
            send({ type: "error", code: "EMPTY_CONTENT", message: "Word 文件内容为空", fileInfo: { name: file.name, size: file.size, type: file.type } });
            safeClose();
            return;
          }
          const lines = text.split("\n").filter((l) => l.trim());
          const total = lines.length;
          send({ type: "start", total, message: `共 ${total} 行文本` });
          const rawData = lines.map((line, i) => ({
            rowIndex: i,
            cells: { text: line, col_0: line },
          }));
          const result = await executeRule(rawData, rule, file.name, (processed, total, msg) => {
            send({ type: "progress", processed, total, message: msg });
          });
          orders = result.orders;
        } else if (fileType === "pdf") {
          let parseResult: Awaited<ReturnType<typeof parsePDF>>;
          try {
            parseResult = await parsePDF(buffer);
          } catch (e) {
            send({
              type: "error",
              code: "PDF_PARSE_FAILED",
              message: `PDF 解析失败：${e instanceof Error ? e.message : "文件可能已损坏、为扫描件（无文字层）或加密"}`,
              fileInfo: { name: file.name, size: file.size, type: file.type },
            });
            safeClose();
            return;
          }
          const { fullText, rows2d } = parseResult;
          if (!fullText || !fullText.trim()) {
            send({ type: "error", code: "EMPTY_CONTENT", message: "PDF 文件无文本内容（可能是扫描件或图片型 PDF）", fileInfo: { name: file.name, size: file.size, type: file.type } });
            safeClose();
            return;
          }

          // 优先走"二维表抽取"路径（auto-detected 表格 + 表头）—— 复用 Excel 规则引擎逻辑
          if (rows2d && rows2d.length >= 2) {
            // 把表头行号覆盖到 rule.dataRegion.headerRow
            const adjustedRule = {
              ...rule,
              dataRegion: {
                ...rule.dataRegion,
                headerRow: parseResult.headerRow ?? 0,
                skipRows: parseResult.headerRow ?? 0,
              },
            };
            const total = rows2d.length;
            send({ type: "start", total, message: `PDF 自动识别到 ${rows2d.length} 行（表头行 ${(parseResult.headerRow ?? 0) + 1}）` });
            const rawData = excelToRawData(rows2d, adjustedRule);
            const result = await executeRule(rawData, adjustedRule, file.name, (processed, total, msg) => {
              send({ type: "progress", processed, total, message: msg });
            });
            orders = result.orders;
          } else {
            // 兜底：纯文本行模式（无表格的 PDF）
            const lines = fullText.split("\n").filter((l) => l.trim());
            const total = lines.length;
            send({ type: "start", total, message: `PDF 共 ${total} 行文本（无表格）` });
            const rawData = lines.map((line, i) => ({
              rowIndex: i,
              cells: { text: line, col_0: line },
            }));
            const result = await executeRule(rawData, rule, file.name, (processed, total, msg) => {
              send({ type: "progress", processed, total, message: msg });
            });
            orders = result.orders;
          }
        }

        // 7. 校验汇总
        const errors = orders.flatMap((o) => o.errors || []).filter(Boolean);
        const errorCount = orders.filter((o) => o.status === "error").length;
        const parseTime = performance.now() - parseStart;

        const result: ParseResult = {
          orders,
          totalCount: orders.length,
          successCount: orders.length - errorCount,
          errorCount,
          errors,
          parseTime,
        };

        // 8. 检查是否真的解析到了数据
        if (orders.length === 0) {
          send({
            type: "error",
            code: "NO_DATA_PARSED",
            message: "未能从文件中解析出任何数据，请检查文件内容或调整解析规则",
            fileInfo: { name: file.name, size: file.size, type: file.type },
          });
          safeClose();
          return;
        }

        send({ type: "done", result });
        safeClose();
      } catch (error) {
        // 兜底：把异常也推给客户端，便于排查 "解析流意外中断" 类问题
        const msg = error instanceof Error ? `${error.message}\n${error.stack || ""}` : "未知错误";
        console.error("[Parse] Fatal error:", msg);
        try {
          send({
            type: "error",
            code: "INTERNAL_ERROR",
            message: `解析过程中发生未捕获异常：${msg}`.slice(0, 1500),
            fileInfo: { name: "?", size: 0, type: "?" },
          });
        } catch { /* 流已关闭 */ }
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
