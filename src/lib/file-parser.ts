// 文件解析器 - 支持 Excel、Word、PDF 格式

import * as XLSX from "xlsx";

// 解析 Excel 文件
export async function parseExcel(
  buffer: ArrayBuffer
): Promise<{ sheets: Record<string, (string | number | null)[][]>; sheetNames: string[] }> {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheets: Record<string, (string | number | null)[][]> = {};
  const sheetNames: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(
      worksheet,
      { header: 1, defval: null }
    );
    sheets[sheetName] = data;
    sheetNames.push(sheetName);
  }

  return { sheets, sheetNames };
}

// 将 Excel 数据转为文本表示（用于 AI 分析）
export function excelToText(
  data: (string | number | null)[][],
  maxRows: number = 30
): string {
  const rows = data.slice(0, maxRows);
  return rows
    .map((row, i) => `行${i + 1}: ${row.map((c) => String(c ?? "")).join(" | ")}`)
    .join("\n");
}

// 解析 Word 文件（使用 mammoth.js）
export async function parseWord(
  buffer: ArrayBuffer
): Promise<string> {
  // 动态导入 mammoth
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  return result.value;
}

// 解析 PDF 文件（使用 pdfjs-dist）
export async function parsePDF(
  buffer: ArrayBuffer
): Promise<{ pages: string[]; fullText: string }> {
  const pdfjsLib = await import("pdfjs-dist");

  // 设置 worker
  if (typeof window === "undefined") {
    // 服务端
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? (item as { str: string }).str : ""))
      .join(" ");
    pages.push(text);
  }

  return {
    pages,
    fullText: pages.join("\n---PAGE_BREAK---\n"),
  };
}

// 检测文件类型
export function detectFileType(fileName: string): "excel" | "word" | "pdf" | "unknown" {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") return "excel";
  if (ext === "docx" || ext === "doc") return "word";
  if (ext === "pdf") return "pdf";
  return "unknown";
}

// 获取文件格式的 MIME 类型
export function getAcceptTypes(): string {
  return ".xlsx,.xls,.docx,.pdf";
}

// 将文本行解析为结构化数据（用于 Word 纯文本解析）
export function parseTextLines(
  text: string,
  recordMarker?: string,
  separator?: string
): { sections: string[]; lines: string[] } {
  const lines = text.split("\n").filter((l) => l.trim());

  const sections: string[] = [];
  if (recordMarker) {
    let currentSection = "";
    for (const line of lines) {
      if (line.includes(recordMarker)) {
        if (currentSection) sections.push(currentSection.trim());
        currentSection = line + "\n";
      } else {
        currentSection += line + "\n";
      }
    }
    if (currentSection) sections.push(currentSection.trim());
  }

  return { sections: sections.length > 0 ? sections : [text], lines };
}

// 模拟解析时间测量
export function measureParseTime<T>(fn: () => T): { result: T; time: number } {
  const start = performance.now();
  const result = fn();
  const time = performance.now() - start;
  return { result, time };
}
