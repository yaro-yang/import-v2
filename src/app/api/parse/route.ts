import { NextRequest, NextResponse } from "next/server";
import { parseExcel, parseWord, parsePDF, detectFileType, excelToText, measureParseTime } from "@/lib/file-parser";
import { executeRule, excelToRawData } from "@/lib/rule-engine";
import { getRuleById } from "@/lib/db";
import { ensureDB } from "@/lib/ensure-db";
import { ApiResponse, ParseResult, OrderItem } from "@/types";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: NextRequest) {
  await ensureDB();
  const parseStart = performance.now();
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const ruleId = formData.get("ruleId") as string;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "未上传文件" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    if (!ruleId) {
      return NextResponse.json(
        { success: false, error: "未选择解析规则" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    // 获取规则
    const rule = await getRuleById(ruleId);
    if (!rule) {
      return NextResponse.json(
        { success: false, error: "解析规则不存在" } as ApiResponse<null>,
        { status: 404 }
      );
    }

    // 读取文件内容
    const buffer = await file.arrayBuffer();
    const fileType = detectFileType(file.name);

    if (fileType === "unknown") {
      return NextResponse.json(
        { success: false, error: "不支持的文件格式" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    let orders: OrderItem[] = [];

    // 解析文件
    if (fileType === "excel") {
      const { sheets } = await parseExcel(buffer);

      // 遍历所有 Sheet（支持 mergeSheets 模式）
      const sheetNames = rule.globalConfig.mergeSheets
        ? Object.keys(sheets)
        : (rule.dataRegion.sheetNames || Object.keys(sheets));

      for (const sheetName of sheetNames) {
        const sheetData = sheets[sheetName];
        if (!sheetData) continue;

        const rawData = excelToRawData(sheetData, rule);
        const result = await executeRule(rawData, rule, file.name);

        // 添加 sheet 信息
        for (const order of result.orders) {
          order.sourceSheet = sheetName;
        }
        orders.push(...result.orders);
      }
    } else if (fileType === "word") {
      const text = await parseWord(buffer);
      // Word 解析：将文本按行拆分
      const lines = text.split("\n").filter((l) => l.trim());
      const rawData = lines.map((line, i) => ({
        rowIndex: i,
        cells: { text: line, col_0: line },
      }));
      const result = await executeRule(rawData, rule, file.name);
      orders = result.orders;
    } else if (fileType === "pdf") {
      const { fullText } = await parsePDF(buffer);
      // PDF 解析：保持页面分隔符，支持多订单拆分
      const lines = fullText.split("\n");
      const rawData = lines.map((line, i) => ({
        rowIndex: i,
        cells: { text: line, col_0: line },
      }));
      const result = await executeRule(rawData, rule, file.name);
      orders = result.orders;
    }

    // 校验
    const errors = orders
      .flatMap((o) => o.errors || [])
      .filter(Boolean);
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

    return NextResponse.json({
      success: true,
      data: result,
    } as ApiResponse<ParseResult>);
  } catch (error) {
    console.error("Parse error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "解析失败",
      } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
