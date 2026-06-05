import { NextRequest, NextResponse } from "next/server";
import { analyzeFileWithAI } from "@/lib/ai-service";
import { parseExcel, parseWord, parsePDF, detectFileType, excelToText } from "@/lib/file-parser";
import { ApiResponse, AIAnalyzeResponse } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "未上传文件" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const fileType = detectFileType(file.name);

    if (fileType === "unknown") {
      return NextResponse.json(
        { success: false, error: "不支持的文件格式" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    let fileContent = "";
    let sampleRows: string[][] = [];

    // 解析文件为文本供 AI 分析
    if (fileType === "excel") {
      const { sheets } = await parseExcel(buffer);
      const sheetNames = Object.keys(sheets);
      // 发送所有 sheet 的摘要
      const allContent: string[] = [];
      for (const sn of sheetNames) {
        const data = sheets[sn];
        if (data) {
          allContent.push(`--- Sheet: ${sn} (${data.length}行) ---`);
          allContent.push(excelToText(data, 30));
        }
      }
      fileContent = allContent.join("\n");
      // 第一个 sheet 的前10行作为样本
      const firstSheet = sheets[sheetNames[0]];
      if (firstSheet) {
        sampleRows = firstSheet.slice(0, 10).map((row) =>
          row.map((c) => String(c ?? ""))
        );
      }
    } else if (fileType === "word") {
      const text = await parseWord(buffer);
      fileContent = text.substring(0, 8000);
    } else if (fileType === "pdf") {
      const { fullText } = await parsePDF(buffer);
      fileContent = fullText.substring(0, 8000);
    }

    // 调用 AI 分析
    const analysis = await analyzeFileWithAI({
      fileContent,
      fileName: file.name,
      fileType,
      sampleRows,
    });

    return NextResponse.json({
      success: true,
      data: analysis,
    } as ApiResponse<AIAnalyzeResponse>);
  } catch (error) {
    console.error("AI analysis error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "AI 分析失败",
      } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
