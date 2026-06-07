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
// 返回结构：
//   - pages: 每页文本（按视觉行分行的字符串）
//   - fullText: 整篇文本（用 \n---PAGE_BREAK---\n 分页）
//   - rows2d: 自动按"列头行"切分后的二维数组（复用 Excel 风格）
//   - headerRow: 识别到的列头行号（0-based，相对于 rows2d）
//   - keyValueLines: 全文中的 key: value 形式元数据行（收货机构/单据编号/收货人/电话/地址等）
export async function parsePDF(
  buffer: ArrayBuffer
): Promise<{ pages: string[]; fullText: string; rows2d?: (string | number | null)[][]; headerRow?: number; keyValueLines?: string[] }> {
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
    // ====== 关键：按视觉行分组 ======
    // PDF 的 textContent.items 顺序通常是按"行从左到右、行从上到下"，但同一行的多段可能来自
    // 不同的 text block，因此不能简单用 transform[5]（y 坐标）分组。
    // 我们用"y 坐标聚类"——相邻 y 距离小于阈值（如字号 * 0.7）则视为同一行。
    const items = textContent.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    }>;
    const lines: { y: number; parts: string[] }[] = [];
    for (const it of items) {
      const str = it.str || "";
      // 跳过空 token 和纯空白（避免空行）
      if (!str.replace(/\s/g, "")) continue;
      // y 坐标：transform[5] 是 PDF 坐标系（左下为原点，y 越大越靠上）
      const y = Array.isArray(it.transform) && it.transform.length >= 6 ? it.transform[5] : 0;
      // 字号高度：transform[3] 是缩放因子；粗略用 height 字段
      const fontHeight = (Array.isArray(it.transform) && it.transform.length >= 4) ? Math.abs(it.transform[3]) || 10 : 10;
      const tol = fontHeight * 0.7; // 行间合并阈值
      if (lines.length > 0 && Math.abs(lines[lines.length - 1].y - y) <= tol) {
        // 同行：追加
        // 如果上一个 token 以空白结尾或下一个 token 以空白开头，省略拼接空格
        const last = lines[lines.length - 1].parts;
        if (/[\s]$/.test(last[last.length - 1]) || /^[\s]/.test(str)) {
          last.push(str);
        } else {
          last.push(" " + str);
        }
      } else {
        lines.push({ y, parts: [str] });
      }
    }
    // 按 y 倒序（PDF 坐标系 y 越大越靠上，对应文档越靠前）
    lines.sort((a, b) => b.y - a.y);
    const pageText = lines.map((l) => l.parts.join("").replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
    pages.push(pageText);
  }

  const fullText = pages.join("\n---PAGE_BREAK---\n");

  // ====== 二维表抽取（自动列头识别） ======
  // 关键点：PDF 的"视觉行"经 pdfjs 解析后，同一行的多列 token 用单空格分隔
  // （不是多空格），所以需要用"列数对齐"策略而不是"多空格 split"
  const allLines = fullText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const HEADER_KEYWORDS = [
    "物品类别", "物品编码", "物品名称", "物品品牌", "规格型号",
    "订货单位", "发货数量", "订货数量", "应发数量",
    "批次号", "生产日期", "辅助单位", "备注", "序号",
  ];
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(allLines.length, 30); i++) {
    const ln = allLines[i];
    let hits = 0;
    for (const kw of HEADER_KEYWORDS) if (ln.includes(kw)) hits++;
    if (hits >= 3) { headerRowIdx = i; break; }
  }
  let rows2d: (string | number | null)[][] | undefined;
  let detectedHeaderRow: number | undefined;
  let hasSeqCol = false;
  if (headerRowIdx >= 0) {
    // 把表头按单空格 split（因为 PDF 视觉行内 token 是单空格分隔的）
    const headerLine = allLines[headerRowIdx];
    let headerCols = headerLine.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    // 如果表头不包含"序号"但数据行明显是"数字+内容"模式（首个 token 是 1/2/3...），
    // 自动在表头前面加一列"序号"以保证列对齐
    hasSeqCol = headerCols.includes("序号") || headerCols[0] === "序号";
    if (!hasSeqCol && headerCols[0] !== "序号") {
      // 检查下一行（第一条数据行）的第一个 token 是否是纯数字
      const firstDataLineIdx = headerRowIdx + 1;
      if (firstDataLineIdx < allLines.length) {
        const firstDataLine = allLines[firstDataLineIdx];
        const firstToken = firstDataLine.split(/\s+/)[0];
        if (/^\d+$/.test(firstToken) && Number(firstToken) <= 200) {
          // 大概率有"序号"列（但 PDF 把序号和类别都给了中文"物品类别"在 col_0，实际数据是 col_0=序号 col_1=类别）
          headerCols = ["序号", ...headerCols];
          hasSeqCol = true;
        }
      }
    }
    if (headerCols.length >= 3) {
      // 关键：rows2d 包含表头之前的"key:value 元数据行"和表头行。
      // 这样 excelToRawData 的 preHeaderFields 提取能扫到它们。
      // 之后再加表头本身。
      // 但为了不破坏"headerRow=0"的语义（让所有元数据行算在表头之前），
      // 我们把元数据行放在表头行之前（rows2d 前面）。
      const metaRowsBefore: string[][] = [];
      const dataRows: string[][] = [];
      for (let i = 0; i < allLines.length; i++) {
        if (i === headerRowIdx) continue; // 表头行单独处理
        const line = allLines[i];
        if (line.length < 3) continue;
        // 元数据行（key:value 形式）：原样保留到 rows2d（cell[0] = "key：value"）
        if (/^[^\s：:]{1,12}[：:][^\s：:]/.test(line)) {
          metaRowsBefore.push([line]);
          continue;
        }
        // 页码/分割线跳过
        if (/^第\s*\d+\s*页/.test(line)) continue;
        if (/^\d+\s*\/\s*\d+/.test(line)) continue;
        if (/合计|合\s*计/.test(line)) continue;
        const tokens = line.split(/\s+/).filter(Boolean);
        if (tokens.length < headerCols.length - 1) continue;
        // 关键：PDF 解析时可能把"规格型号"列（值含 "/" "kg" "件" 等）错误切分成多个 token
        // 这里做一个"前向合并"——如果当前 token 是数字/单位（"件/袋/箱"等）且前一个 token
        // 以 "/" 或 "*" 结尾（"1.25kg*12瓶/"），则把它们合并
        const merged: string[] = [];
        for (let k = 0; k < tokens.length; k++) {
          const tk = tokens[k];
          if (merged.length > 0) {
            const prev = merged[merged.length - 1];
            if (/[/\\*]$/.test(prev) && !/^\d+$/.test(tk) && !/^[A-Z]+\d/.test(tk)) {
              merged[merged.length - 1] = prev + tk;
              continue;
            }
            if (/[xX×]\d+$/.test(prev) && /^(件|袋|包|桶|盒|箱|片|个|只|条|kg|g|ml|L)$/.test(tk)) {
              merged[merged.length - 1] = prev + tk;
              continue;
            }
          }
          merged.push(tk);
        }
        const finalTokens = merged;
        if (finalTokens.length < headerCols.length - 1) continue;
        // 去重：跨页重复出现的表头行（"物品类别 物品编码 ..."）跳过
        if (finalTokens.length >= headerCols.length - 1) {
          const headerWithoutSeq = headerCols.filter(h => h !== "序号");
          if (finalTokens.slice(0, headerWithoutSeq.length).every((tk, i) => tk === headerWithoutSeq[i])) continue;
        }
        let cells: string[];
        if (finalTokens.length === headerCols.length) {
          cells = finalTokens;
        } else if (finalTokens.length > headerCols.length) {
          // 多 token：启发式找到"规格型号"列，把多余 token 合并到那一列
          // 规格型号通常是"1.25kg*12瓶/件"等含 "/" "x" "kg" 的复合值
          const specHints = /规格|型号|spec|说明/;
          let specIdx = -1;
          for (let k = 1; k < headerCols.length; k++) {
            if (specHints.test(headerCols[k])) { specIdx = k; break; }
          }
          if (specIdx > 0) {
            const extra = finalTokens.length - headerCols.length;
            cells = finalTokens.slice(0, specIdx);
            const merged = finalTokens.slice(specIdx, specIdx + 1 + extra).join(" ");
            cells.push(merged);
            cells.push(...finalTokens.slice(specIdx + 1 + extra));
            while (cells.length < headerCols.length) cells.push("");
            if (cells.length > headerCols.length) cells.length = headerCols.length;
          } else {
            cells = finalTokens.slice(0, headerCols.length - 1);
            cells.push(finalTokens.slice(headerCols.length - 1).join(" "));
          }
        } else {
          cells = [...finalTokens];
          while (cells.length < headerCols.length) cells.push("");
        }
        dataRows.push(cells);
      }
      rows2d = [...metaRowsBefore, headerCols, ...dataRows];
      // 重新计算 headerRow：元数据行数 = 表头行在 rows2d 中的索引
      detectedHeaderRow = metaRowsBefore.length;
    }
  }

  // 提取 key:value 元数据行
  const keyValueLines = allLines.filter((l) => /^[^\s：:]{1,12}[：:][^\s：:]/.test(l));

  return {
    pages,
    fullText,
    rows2d,
    headerRow: detectedHeaderRow,
    keyValueLines,
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
