// 文件解析器 - 支持 Excel、Word、PDF 格式

import * as XLSX from "xlsx";

// pdfjs-dist 4.x 内部使用了 Promise.withResolvers()（ES2024 API），
// 在某些 JS 引擎（老版本 Node、Webpack 沙箱、Edge Runtime 早期版本）下可能不存在，
// 导致解析 PDF 时报 "Promise.withResolvers is not a function"。
// 这里加一个防御性 polyfill：仅在缺失时注入，实现与规范一致。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (Promise as any).withResolvers !== "function") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Promise as any).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

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

  const isServer = typeof window === "undefined";

  if (isServer) {
    // 服务端：没有真正的 Worker，但 pdfjs-dist 4.x 必须显式给 workerSrc 才会用 fake worker 跑在主线程。
    // 直接指向磁盘上 node_modules 里的 worker 路径（Node 端用 file:// URL 加载 ESM）。
    try {
      const { pathToFileURL } = await import("url");
      const path = await import("path");
      // Node CWD 是项目根目录，worker 文件固定在 node_modules/pdfjs-dist/build/pdf.worker.mjs
      const workerPath = path.resolve(
        process.cwd(),
        "node_modules/pdfjs-dist/build/pdf.worker.mjs"
      );
      pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    } catch {
      // 兜底：让 pdfjs-dist 内部走 fake worker 流程（主线程跑解析）
      pdfjsLib.GlobalWorkerOptions.workerSrc = "";
    }
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
  _separator?: string
): { sections: string[]; lines: string[] } {
  const lines = text.split("\n");

  const sections: string[] = [];
  if (recordMarker) {
    let currentSection = "";
    for (const line of lines) {
      if (line.includes(recordMarker)) {
        if (currentSection.trim()) sections.push(currentSection.trim());
        currentSection = line + "\n";
      } else {
        currentSection += line + "\n";
      }
    }
    if (currentSection.trim()) sections.push(currentSection.trim());
  }

  return {
    sections: sections.length > 0 ? sections : [text],
    lines: lines.filter((l) => l.trim()),
  };
}

// 模拟解析时间测量
export function measureParseTime<T>(fn: () => T | Promise<T>): { result: Promise<T>; time: number } {
  const start = performance.now();
  const result = fn();
  const time = performance.now() - start;
  return { result: result instanceof Promise ? result : Promise.resolve(result), time };
}
