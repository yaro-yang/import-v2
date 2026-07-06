// V3 大模型辅助 - AI异常类型建议（加分项）
import { NextRequest, NextResponse } from "next/server";
import { ApiResponse } from "@/types";

const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_URL = process.env.AI_API_URL || "https://api.deepseek.com/chat/completions";
const AI_MODEL = process.env.AI_MODEL || "deepseek-chat";

const EXCEPTION_CATEGORIES = [
  { type: "lost", label: "丢件", keywords: ["丢", "找不到", "遗失", "失踪", "不见", "丢失"] },
  { type: "damaged", label: "破损", keywords: ["破", "碎", "裂", "损", "坏", "变形", "压扁"] },
  { type: "rejected", label: "客户拒收", keywords: ["拒收", "拒签", "退回", "不接受", "拒绝"] },
  { type: "timeout", label: "超时未签收", keywords: ["超时", "未签收", "延误", "延迟", "太久"] },
  { type: "address_error", label: "地址错误", keywords: ["地址错", "地址不对", "地址有误", "找不到地址", "写错"] },
  { type: "qc_quantity", label: "数量不符", keywords: ["数量不对", "少", "多", "数错", "数量差", "缺少"] },
  { type: "qc_appearance", label: "外观破损", keywords: ["外观", "破损", "损坏", "压坏", "刮花", "裂开"] },
  { type: "qc_spec", label: "规格不符", keywords: ["规格", "尺寸不对", "型号不对", "不符", "不一样"] },
  { type: "qc_label", label: "标签错误", keywords: ["标签", "贴错", "标错", "条码", "印刷"] },
  { type: "qc_batch", label: "批次异常", keywords: ["批次", "批号", "生产日期", "过期", "保质期"] },
];

// 关键词匹配（完全离线，不依赖AI也可正常工作）
function keywordMatch(description: string): { type: string; label: string; confidence: number }[] {
  const desc = description.toLowerCase();
  const results: { type: string; label: string; confidence: number }[] = [];
  
  for (const cat of EXCEPTION_CATEGORIES) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (desc.includes(kw)) score += 1;
    }
    if (score > 0) {
      results.push({ type: cat.type, label: cat.label, confidence: Math.min(score / 3, 1) });
    }
  }
  
  return results.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

// AI 辅助分类
async function aiClassify(description: string): Promise<{ suggestedType: string; confidence: number; explanation: string } | null> {
  if (!AI_API_KEY) return null;
  if (!description || description.trim().length < 5) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: `你是一个物流异常分类专家。根据异常描述，判断异常类型。

可选类型：
- lost: 丢件
- damaged: 破损
- rejected: 客户拒收
- timeout: 超时未签收
- address_error: 地址错误
- qc_quantity: 数量不符（品控）
- qc_appearance: 外观破损（品控）
- qc_spec: 规格不符（品控）
- qc_label: 标签错误（品控）
- qc_batch: 批次异常（品控）

返回JSON: {"type":"类型编码","confidence":0.85,"explanation":"分类理由"}` },
          { role: "user", content: `请分类以下异常描述："${description}"` },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // 解析JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const result = JSON.parse(jsonMatch[0]);
    return {
      suggestedType: result.type,
      confidence: Math.min(result.confidence || 0.5, 1),
      explanation: result.explanation || "AI 自动分析",
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description } = body;

    if (!description) {
      return NextResponse.json(
        { success: false, error: "description is required" } as ApiResponse<null>,
        { status: 400 }
      );
    }

    const suggestions = keywordMatch(description);

    // AI 增强（可选，不影响主流程）
    let aiResult = null;
    try {
      aiResult = await aiClassify(description);
    } catch { /* AI失败不影响主流程 */ }

    return NextResponse.json({
      success: true,
      data: {
        suggestions,
        aiSuggestion: aiResult
          ? {
              type: aiResult.suggestedType,
              confidence: aiResult.confidence,
              explanation: aiResult.explanation,
              disclaimer: "AI 建议，需人工确认",
            }
          : null,
      },
    } as ApiResponse<Record<string, unknown>>);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "分类失败" } as ApiResponse<null>,
      { status: 500 }
    );
  }
}
