"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import toast from "react-hot-toast";
import { FileUploader } from "@/components/upload/FileUploader";
import { RuleSelector } from "@/components/upload/RuleSelector";
import { DataPreviewTable } from "@/components/preview/DataPreviewTable";
import { RuleEditor } from "@/components/preview/RuleEditor";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { StatBlock, Divider } from "@/components/ui/TableDecorations";
import {
  ParseRule,
  OrderItem,
  ParseResult,
  AIAnalyzeResponse,
  ValidationError,
} from "@/types";
import { formatFileSize, formatTime, exportToExcel } from "@/lib/utils";

type Step = "upload" | "select-rule" | "preview" | "submitted";

// 解析错误信息（解析失败时展示给用户）
interface ParseError {
  code: string;
  message: string;
  fileInfo: { name: string; size: number; type: string };
}

export default function HomePage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseProcessed, setParseProcessed] = useState(0);
  const [parseTotal, setParseTotal] = useState(0);
  const [parseMessage, setParseMessage] = useState("");
  const [parseTime, setParseTime] = useState(0);
  const [submittedCount, setSubmittedCount] = useState(0);

  // 解析错误状态
  const [parseError, setParseError] = useState<ParseError | null>(null);

  // 实时校验结果（来自 DataPreviewTable）
  const [liveErrors, setLiveErrors] = useState<ValidationError[]>([]);
  const [, setLiveErrorOrderIds] = useState<Set<string>>(new Set());
  const [duplicateCodes, setDuplicateCodes] = useState<string[]>([]);

  // 当前选中规则的 mode（outbound/transfer）— 用于提交时告诉后端按哪种模式落库
  const [currentRuleMode, setCurrentRuleMode] = useState<"outbound" | "transfer">("outbound");

  // 实际显示模式：根据数据结构自动检测
  // - 若任一 externalCode 下有 ≥2 个不同 storeName → transfer（合并单元格展示）
  // - 否则 → outbound（扁平展示）
  // 注：currentRuleMode 只影响提交时落库方式，不影响预览表格的展示形式
  const effectiveDisplayMode = useMemo<"outbound" | "transfer">(() => {
    const codeStores = new Map<string, Set<string>>();
    for (const o of orders) {
      const code = (o.externalCode || "").trim();
      if (!code) continue;
      const store = (o.storeName || "").trim();
      if (!codeStores.has(code)) codeStores.set(code, new Set());
      codeStores.get(code)!.add(store);
    }
    for (const stores of codeStores.values()) {
      if (stores.size >= 2) return "transfer";
    }
    return "outbound";
  }, [orders]);

  // 提交按钮防重复
  const [submitting, setSubmitting] = useState(false);

  // 提交进度
  const [submitProgress, setSubmitProgress] = useState(0);
  const [submitMessage, setSubmitMessage] = useState("");

  // 规则编辑器状态
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<ParseRule> | null>(
    null
  );
  const [aiAnalysisResult, setAiAnalysisResult] =
    useState<AIAnalyzeResponse | null>(null);

  // AI 分析状态
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // 文件选择（仅加载已有规则，不做 AI 自动分析）
  const handleFileSelect = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setStep("select-rule");
      setOrders([]);
      setErrors([]);
      setSelectedRuleId(null);
      setShowRuleEditor(false);
      setEditingRule(null);
      setAiAnalysisResult(null);
      setParseError(null);
      setParseProgress(0);
      setParseProcessed(0);
      setParseTotal(0);
      setParseMessage("");

      // 加载已有规则列表
      try {
        const res = await fetch("/api/rules");
        const data = await res.json();
        if (data.success) {
          setRules(data.data);
        }
      } catch (err) {
        console.error("Failed to load rules:", err);
      }
    },
    []
  );

  // 打开手动配置规则弹窗（用于"解析失败"时提供手动配置入口）
  const openManualRuleEditor = useCallback(async () => {
    if (!file) return;
    setParseError(null);
    // 先尝试 AI 分析
    setAiAnalyzing(true);
    setAiAnalysisResult(null);
    const toastId = toast.loading("🤖 AI 正在分析文件结构...");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/ai-generate-rules", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.data) {
        setAiAnalysisResult(data.data);
        setEditingRule(data.data.suggestedRule || {});
        toast.success("✅ AI 分析完成，请检查并确认", { id: toastId });
      } else {
        setEditingRule({
          fileType: file.name.endsWith(".pdf")
            ? "pdf"
            : file.name.endsWith(".docx")
              ? "word"
              : "excel",
        });
        toast.error(data.error || "AI 分析失败，请手动配置", { id: toastId });
      }
    } catch (err) {
      console.error("AI analysis failed:", err);
      setEditingRule({
        fileType: file.name.endsWith(".pdf")
          ? "pdf"
          : file.name.endsWith(".docx")
            ? "word"
            : "excel",
      });
      toast.error("AI 分析失败，请手动配置", { id: toastId });
    } finally {
      setAiAnalyzing(false);
      setShowRuleEditor(true);
    }
  }, [file]);

  // 新建规则：触发 AI 预分析，然后打开编辑器让用户确认
  const handleCreateNewRule = useCallback(async () => {
    if (!file) return;
    setAiAnalyzing(true);
    setAiAnalysisResult(null);
    setParseError(null);
    const toastId = toast.loading("🤖 AI 正在分析文件结构，生成推荐解析规则...");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/ai-generate-rules", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.success && data.data) {
        setAiAnalysisResult(data.data);
        setEditingRule(data.data.suggestedRule || {});
        setShowRuleEditor(true);
        toast.success("✅ AI 分析完成，请检查并确认推荐的解析规则", { id: toastId });
      } else {
        setEditingRule({
          fileType: file.name.endsWith(".pdf")
            ? "pdf"
            : file.name.endsWith(".docx")
              ? "word"
              : "excel",
        });
        setShowRuleEditor(true);
        toast.error(data.error || "AI 分析失败，已打开手动配置界面", { id: toastId });
      }
    } catch (err) {
      console.error("AI analysis failed:", err);
      setEditingRule({
        fileType: file.name.endsWith(".pdf")
          ? "pdf"
          : file.name.endsWith(".docx")
            ? "word"
            : "excel",
      });
      setShowRuleEditor(true);
      toast.error("AI 分析失败，已打开手动配置界面", { id: toastId });
    } finally {
      setAiAnalyzing(false);
    }
  }, [file]);

  // 保存规则
  const handleSaveRule = useCallback(
    async (rule: ParseRule) => {
      let saveOk = false;
      let saveError = "";
      try {
        const res = await fetch("/api/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rule),
        });
        const data = await res.json();

        if (data.success) {
          saveOk = true;
        } else {
          saveError = data.error || "保存失败";
        }
      } catch (err) {
        console.error("Save rule network error:", err);
        saveError = err instanceof Error ? err.message : "网络错误，规则可能已保存";
      }

      if (!saveOk) {
        toast.error(saveError);
        return;
      }

      toast.success("规则保存成功");
      setSelectedRuleId(rule.id);
      try {
        const rulesRes = await fetch("/api/rules");
        const rulesData = await rulesRes.json();
        if (rulesData.success) {
          setRules(rulesData.data);
        }
      } catch (refreshErr) {
        console.warn("Refresh rules after save failed:", refreshErr);
      }
      setShowRuleEditor(false);
      // 关闭后清空 ai 分析结果
      setAiAnalysisResult(null);
    },
    []
  );

  // 错误码 → 友好标题
  const getErrorTitle = (code: string): string => {
    const map: Record<string, string> = {
      NO_FILE: "未上传文件",
      NO_RULE: "未选择规则",
      EMPTY_FILE: "文件为空",
      FILE_TOO_LARGE: "文件过大",
      RULE_NOT_FOUND: "规则不存在",
      UNSUPPORTED_FORMAT: "不支持的格式",
      READ_FAILED: "读取失败",
      EXCEL_PARSE_FAILED: "Excel 解析失败",
      WORD_PARSE_FAILED: "Word 解析失败",
      PDF_PARSE_FAILED: "PDF 解析失败",
      NO_SHEETS: "工作表为空",
      EMPTY_SHEET: "工作表无数据",
      EMPTY_CONTENT: "文件无内容",
      RULE_EXEC_FAILED: "规则执行失败",
      NO_DATA_PARSED: "未解析到数据",
      INTERNAL_ERROR: "服务器错误",
    };
    return map[code] || "解析失败";
  };

  // 执行解析 - 通过 SSE 流式接收进度和结果
  const handleParse = useCallback(async () => {
    if (!file || !selectedRuleId) {
      toast.error("请选择文件和解析规则");
      return;
    }

    setLoading(true);
    setParseProgress(0);
    setParseProcessed(0);
    setParseTotal(0);
    setParseMessage("准备解析...");
    setParseError(null);
    const startTime = performance.now();
    const toastId = toast.loading("正在解析文件...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ruleId", selectedRuleId);

      const res = await fetch("/api/parse", {
        method: "POST",
        body: formData,
      });

      if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
        // 服务端在流开始前就返回了 JSON 错误
        const errData = await res.json();
        const pe: ParseError = {
          code: errData.code || "INTERNAL_ERROR",
          message: errData.error || "解析失败",
          fileInfo: { name: file.name, size: file.size, type: file.type },
        };
        setParseError(pe);
        setLoading(false);
        toast.error(getErrorTitle(pe.code), { id: toastId });
        return;
      }

      if (!res.body) {
        throw new Error("服务器无响应");
      }

      // 读取 SSE 流
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneReceived = false;
      // 同步标记：error/done 已被处理（避免 React state 异步更新导致后续误判）
      let finished: "done" | "error" | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 事件以 "\n\n" 分隔
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventStr of events) {
          const line = eventStr.trim();
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          let event: { type: string;[k: string]: unknown };
          try {
            event = JSON.parse(jsonStr);
          } catch (e) {
            console.error("Failed to parse SSE event:", jsonStr, e);
            continue;
          }

          if (event.type === "start") {
            const total = event.total as number;
            setParseTotal(total);
            setParseMessage((event.message as string) || `共 ${total} 条`);
            setParseProgress(0);
            setParseProcessed(0);
          } else if (event.type === "progress") {
            const processed = event.processed as number;
            const total = (event.total as number) || 1;
            setParseProcessed(processed);
            setParseTotal(total);
            setParseProgress((processed / total) * 100);
            if (event.message) setParseMessage(event.message as string);
          } else if (event.type === "done") {
            doneReceived = true;
            finished = "done";
            const result = event.result as ParseResult;
            setOrders(result.orders);
            setErrors(result.errors || []);
            setParseTime(performance.now() - startTime);
            setParseProgress(100);
            setParseMessage(`解析完成，共 ${result.totalCount} 条`);
            setStep("preview");

            // 解析完成后，异步检测外部编码是否在数据库已存在
            try {
              const codes = result.orders
                .map((o) => (o.externalCode || "").trim())
                .filter(Boolean);
              if (codes.length > 0) {
                const dupRes = await fetch("/api/orders/check-duplicate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ codes }),
                });
                const dupData = await dupRes.json();
                if (dupData.success) {
                  const dbDuplicates: string[] = Object.keys(dupData.data.duplicates);
                  if (dbDuplicates.length > 0) {
                    // 给数据库已存在的外部编码对应的行加错误
                    const dbErrors: ValidationError[] = [];
                    for (const o of result.orders) {
                      if (o.externalCode && dbDuplicates.includes(o.externalCode.trim())) {
                        dbErrors.push({
                          row: o.sourceRow || 0,
                          field: "externalCode",
                          message: `外部编码「${o.externalCode}」在数据库已存在（提交时将覆盖）`,
                          severity: "warning",
                        });
                      }
                    }
                    setErrors((prev) => [...prev, ...dbErrors]);
                    toast(`检测到 ${dbDuplicates.length} 个外部编码在数据库已存在`, {
                      id: toastId,
                      icon: "⚠️",
                    });
                  } else {
                    if (result.errorCount > 0) {
                      toast(`解析完成，${result.errorCount} 条数据存在错误`, {
                        id: toastId,
                        icon: "⚠️",
                      });
                    } else {
                      toast.success(
                        `解析完成！共 ${result.totalCount} 条数据 (${formatTime(performance.now() - startTime)})`,
                        { id: toastId }
                      );
                    }
                  }
                } else {
                  // 检测失败不影响主流程
                  if (result.errorCount > 0) {
                    toast(`解析完成，${result.errorCount} 条数据存在错误`, {
                      id: toastId,
                      icon: "⚠️",
                    });
                  } else {
                    toast.success(
                      `解析完成！共 ${result.totalCount} 条数据 (${formatTime(performance.now() - startTime)})`,
                      { id: toastId }
                    );
                  }
                }
              } else {
                if (result.errorCount > 0) {
                  toast(`解析完成，${result.errorCount} 条数据存在错误`, {
                    id: toastId,
                    icon: "⚠️",
                  });
                } else {
                  toast.success(
                    `解析完成！共 ${result.totalCount} 条数据 (${formatTime(performance.now() - startTime)})`,
                    { id: toastId }
                  );
                }
              }
            } catch (e) {
              console.error("DB duplicate check failed:", e);
              if (result.errorCount > 0) {
                toast(`解析完成，${result.errorCount} 条数据存在错误`, {
                  id: toastId,
                  icon: "⚠️",
                });
              } else {
                toast.success(
                  `解析完成！共 ${result.totalCount} 条数据 (${formatTime(performance.now() - startTime)})`,
                  { id: toastId }
                );
              }
            }
          } else if (event.type === "error") {
            finished = "error";
            const pe: ParseError = {
              code: event.code as string,
              message: event.message as string,
              fileInfo: event.fileInfo as ParseError["fileInfo"],
            };
            setParseError(pe);
            toast.error(getErrorTitle(pe.code), { id: toastId });
          }
        }
      }

      if (finished !== "done" && finished !== "error") {
        // 流意外关闭（done/error 都没收到）
        throw new Error("解析流意外中断，请重试");
      }
    } catch (err) {
      console.error("Parse error:", err);
      setParseError({
        code: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "解析失败，请检查文件格式和解析规则",
        fileInfo: { name: file.name, size: file.size, type: file.type },
      });
      toast.error("解析失败", { id: toastId });
    } finally {
      setLoading(false);
    }
  }, [file, selectedRuleId]);

  // 更新订单数据
  const handleUpdateOrder = useCallback(
    (id: string, field: string, value: string) => {
      setOrders((prev) =>
        prev.map((order) => {
          if (order.id !== id) return order;
          // 数字字段转换
          let newValue: string | number = value;
          if (field === "skuQuantity" || field === "weight") {
            newValue = value === "" ? 0 : parseFloat(value) || 0;
          }
          return {
            ...order,
            [field]: newValue,
            errors: undefined,
            status: "draft",
          };
        })
      );
    },
    []
  );

  // 删除订单
  const handleDeleteOrder = useCallback((id: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }, []);

  // 新增行 - sourceRow 用当前最大行号+1，避免与已有行冲突
  const handleAddRow = useCallback(() => {
    setOrders((prev) => {
      const maxRow = prev.reduce((max, o) => Math.max(max, o.sourceRow || 0), 0);
      const newOrder: OrderItem = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        skuCode: "",
        skuName: "",
        skuQuantity: 0,
        temperatureLevel: "常温",
        status: "draft",
        sourceFile: file?.name || "",
        sourceRow: maxRow + 1,
        createdAt: new Date().toISOString(),
      };
      return [...prev, newOrder];
    });
  }, [file]);

  // 提交下单
  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    // 校验：使用实时校验结果（有任何错误或警告都不允许提交）
    if (liveErrors.length > 0) {
      toast.error("请先修正所有校验问题后再提交");
      return;
    }
    if (orders.length === 0) {
      toast.error("没有可提交的数据");
      return;
    }

    setSubmitting(true);
    setSubmitProgress(10);
    setSubmitMessage("正在准备数据...");
    const toastId = toast.loading("正在提交订单...");
    try {
      setSubmitProgress(30);
      setSubmitMessage("正在保存到数据库...");
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders, mode: currentRuleMode }),
      });
      setSubmitProgress(80);
      setSubmitMessage("正在处理结果...");
      const data = await res.json();

      if (data.success) {
        setSubmitProgress(100);
        setSubmitMessage("提交完成");
        setSubmittedCount(data.data.savedCount);
        setStep("submitted");
        const uniqueDocCount = data.data.savedOutbounds ?? 0;
        const savedCount = data.data.savedCount ?? 0;
        const okMsg = currentRuleMode === "transfer"
          ? `成功提交 ${data.data.savedTransfers ?? 0} 张调拨单（${data.data.savedOutbounds ?? 0} 个调拨明细，${savedCount} 条 SKU）！`
          : `成功提交 ${uniqueDocCount} 张单据（${savedCount} 条货品）！`;
        toast.success(okMsg, { id: toastId });
      } else {
        setSubmitProgress(0);
        setSubmitMessage("");
        toast.error(data.error || "提交失败", { id: toastId });
      }
    } catch (err) {
      console.error("Submit error:", err);
      setSubmitProgress(0);
      setSubmitMessage("");
      toast.error("提交失败", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }, [orders, liveErrors, submitting, currentRuleMode]);

  // 实时校验回调
  const handleValidationChange = useCallback(
    (result: { errors: ValidationError[]; errorOrderIds: Set<string>; duplicateCodes: string[] }) => {
      setLiveErrors(result.errors);
      setLiveErrorOrderIds(result.errorOrderIds);
      setDuplicateCodes(result.duplicateCodes);
    },
    []
  );

  // 导出 Excel（含当前编辑状态）
  const handleExport = useCallback(() => {
    const exportData = orders.map((order, idx) => ({
      序号: idx + 1,
      外部编码: order.externalCode || "",
      收货门店: order.storeName || "",
      收件人: order.recipientName || "",
      电话: order.recipientPhone || "",
      地址: order.recipientAddress || "",
      SKU编码: order.skuCode || "",
      SKU名称: order.skuName || "",
      发货数量: order.skuQuantity || 0,
      规格型号: order.skuSpec || "",
      重量kg: order.weight ?? "",
      温层: order.temperatureLevel || "",
      备注: order.remark || "",
    }));
    exportToExcel(exportData, `出库单预览_${new Date().toLocaleDateString()}.xlsx`);
    toast.success(`已导出 ${exportData.length} 条数据`);
  }, [orders]);

  // 重新上传
  const handleReset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setSelectedRuleId(null);
    setOrders([]);
    setErrors([]);
    setParseProgress(0);
    setParseProcessed(0);
    setParseTotal(0);
    setParseMessage("");
    setParseTime(0);
    setSubmittedCount(0);
    setSubmitProgress(0);
    setSubmitMessage("");
    setParseError(null);
    setLiveErrors([]);
    setLiveErrorOrderIds(new Set());
    setDuplicateCodes([]);
  }, []);

  return (
    <div className="space-y-4 lg:space-y-5 page-container">
      {/* 吸顶操作区：标题 + 步骤指示器 一体卡片 */}
      <div className="sticky top-[56px] z-30 bg-[#f7f8fa] -mx-5 lg:-mx-8 px-5 lg:px-8 pt-2 pb-3.5 space-y-3">
        {/* 标题 + 描述 一体卡片 */}
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] overflow-hidden">
          <div className="flex items-center gap-3 p-4 lg:p-4.5">
            <div className="w-10 h-10 lg:w-10 lg:h-10 rounded-lg bg-gradient-to-br from-[#0fc6c2] to-[#0bada9] flex items-center justify-center text-white flex-shrink-0 shadow-[0_3px_10px_rgba(15,198,194,0.25)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg lg:text-lg font-semibold text-[#1d2129]">导入下单</h1>
              <p className="text-sm text-[#86909c] mt-0.5">
                上传 Excel / Word / PDF 文件，AI 自动解析并批量下单
              </p>
            </div>
          </div>

          {/* 步骤指示器 - 中小圆点 + 连线 */}
          <div className="border-t border-[#e5e6eb] bg-gradient-to-b from-[#fafbfc] to-white px-4 lg:px-5 py-3.5 lg:py-4">
            <div className="flex items-center">
              {[
                { key: "upload", label: "上传文件" },
                { key: "select-rule", label: "选择规则" },
                { key: "preview", label: "预览编辑" },
                { key: "submitted", label: "提交完成" },
              ].map((s, i, arr) => {
                const stepKeys: Step[] = ["upload", "select-rule", "preview", "submitted"];
                const currentIndex = stepKeys.indexOf(step);
                const isActive = currentIndex >= i;
                const isCurrent = currentIndex === i;
                const isCompleted = currentIndex > i;

                return (
                  <div key={s.key} className="flex items-center flex-1 last:flex-none">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div
                        className={`w-8 h-8 lg:w-9 lg:h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                          isCurrent
                            ? "bg-[#0fc6c2] text-white shadow-[0_3px_10px_rgba(15,198,194,0.35)] ring-[3px] ring-[#e8fafa]"
                            : isActive
                              ? "bg-[#0fc6c2] text-white"
                              : "bg-white text-[#86909c] border-2 border-[#e5e6eb]"
                        }`}
                      >
                        {isActive && !isCurrent ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          i + 1
                        )}
                      </div>
                      <span
                        className={`text-sm font-medium whitespace-nowrap ${
                          isCurrent
                            ? "text-[#0fc6c2] font-semibold"
                            : isActive
                              ? "text-[#1d2129]"
                              : "text-[#86909c]"
                        }`}
                      >
                        {s.label}
                      </span>
                    </div>
                    {i < arr.length - 1 && (
                      <div className="flex-1 mx-1.5 lg:mx-2">
                        <div
                          className={`h-[2px] rounded-full transition-colors ${
                            isCompleted ? "bg-[#0fc6c2]" : "bg-[#e5e6eb]"
                          }`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 步骤 1: 上传文件 */}
      {step === "upload" && (
        <div key="upload" className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-5 lg:p-6 animate-fade-in card-padding-sm">
          <FileUploader onFileSelect={handleFileSelect} />
        </div>
      )}

      {/* 步骤 2: 选择规则 */}
      {step === "select-rule" && file && (
        <div className="animate-fade-in space-y-4 lg:space-y-4.5">
          {/* 文件信息卡片 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-4.5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-lg bg-[#e8fafa] flex items-center justify-center text-[#0fc6c2] flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-medium text-[#1d2129] truncate">
                  {file.name}
                </p>
                <p className="text-sm text-[#86909c] mt-0.5">
                  {formatFileSize(file.size)} ·{" "}
                  {file.name.split(".").pop()?.toUpperCase()}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={handleReset}>
                更换文件
              </Button>
            </div>
          </div>

          {/* 规则选择卡片 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5 mt-5 lg:mt-6">
            <RuleSelector
              rules={rules}
              selectedRuleId={selectedRuleId}
              onSelectRule={(id) => {
                setSelectedRuleId(id);
                // 同步当前规则的 mode 到 state（提交时用）
                const r = rules.find((x) => x.id === id);
                setCurrentRuleMode((r?.globalConfig?.mode as "outbound" | "transfer") || "outbound");
              }}
              onCreateNew={handleCreateNewRule}
              loading={false}
            />
          </div>

          {/* 解析失败时的错误展示 + 手动配置入口 */}
          {parseError && (
            <div className="bg-[#fff1f0] border border-[#ffccc7] rounded-xl p-4 lg:p-5 animate-fade-in">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#ffccc7] text-[#cf1322] flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold text-[#cf1322]">
                      {getErrorTitle(parseError.code)}
                    </h3>
                    <span className="text-xs px-1.5 py-0.5 bg-[#ffccc7] text-[#cf1322] rounded font-mono">
                      {parseError.code}
                    </span>
                  </div>
                  <p className="text-sm text-[#cf1322] mt-1.5 leading-relaxed">
                    {parseError.message}
                  </p>

                  {/* 原始文件信息 */}
                  <div className="mt-3 p-3 bg-white/60 rounded-lg border border-[#ffccc7]/50">
                    <p className="text-xs font-semibold text-[#86909c] mb-1.5">原始文件信息</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-[#4e5969]">
                      <div>
                        <span className="text-[#86909c]">文件名：</span>
                        <span className="font-mono">{parseError.fileInfo.name || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[#86909c]">大小：</span>
                        <span>{formatFileSize(parseError.fileInfo.size)}</span>
                      </div>
                      <div>
                        <span className="text-[#86909c]">MIME：</span>
                        <span className="font-mono">{parseError.fileInfo.type || "—"}</span>
                      </div>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    <Button size="sm" onClick={openManualRuleEditor} loading={aiAnalyzing}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                      </svg>
                      手动配置规则
                    </Button>
                    <Button variant="secondary" size="sm" onClick={handleParse}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                      </svg>
                      重新解析
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleReset}>
                      更换文件
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 操作栏卡片 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-4.5">
            <div className="flex items-center justify-end gap-3">
              <Button
                onClick={handleParse}
                loading={loading}
                disabled={!selectedRuleId}
              >
                开始解析
              </Button>
            </div>

            {/* 进度条 - 实时显示 X / Y 条 */}
            {loading && (
              <div className="mt-4">
                <ProgressBar
                  progress={parseProgress}
                  label={parseMessage || "正在解析..."}
                  showPercent
                  showCount
                  processed={parseProcessed}
                  total={parseTotal}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 步骤 3: 预览编辑 */}
      {step === "preview" && (
        <div className="animate-fade-in space-y-4 lg:space-y-4.5">
          {/* 统计信息卡片 - StatBlock 风格，与已导入运单页统一 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] px-5 py-4 flex flex-wrap items-center gap-5 lg:gap-7">
            <div className="flex items-center gap-5 lg:gap-7 flex-wrap">
              <StatBlock
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="3" y1="15" x2="21" y2="15" />
                  </svg>
                }
                label="总数据"
                value={`${orders.length} 条`}
                tone="primary"
              />
              <Divider />
              <StatBlock
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                }
                label="解析耗时"
                value={formatTime(parseTime)}
                tone="default"
              />
              {liveErrors.length > 0 && (
                <>
                  <Divider />
                  <StatBlock
                    icon={
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    }
                    label="校验问题"
                    value={liveErrors.length}
                    tone="default"
                  />
                </>
              )}
              {duplicateCodes.length > 0 && (
                <>
                  <Divider />
                  <StatBlock
                    icon={
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6l3-3 3 3" />
                        <path d="M6 3v12" />
                        <rect x="3" y="14" width="18" height="6" rx="1" />
                      </svg>
                    }
                    label="外部编码重复"
                    value={duplicateCodes.length}
                    tone="default"
                  />
                </>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto flex-wrap" />
          </div>

          {/* 数据预览表格卡片 */}
          {orders.length > 0 ? (
            <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5">
              <DataPreviewTable
                orders={orders}
                onUpdateOrder={handleUpdateOrder}
                onDeleteOrder={handleDeleteOrder}
                onAddRow={handleAddRow}
                errors={errors}
                mode={effectiveDisplayMode}
                onValidationChange={handleValidationChange}
              />
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-6 lg:p-10">
              <EmptyState
                title="没有解析到数据"
                description="请检查解析规则配置是否正确，或尝试调整规则"
              />
            </div>
          )}

          {/* 提交进度条 */}
          {submitting && (
            <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5">
              <ProgressBar
                progress={submitProgress}
                label={submitMessage}
                showPercent={false}
                variant={submitProgress >= 100 ? "success" : "primary"}
              />
            </div>
          )}

          {/* 操作按钮卡片 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-4.5 sticky bottom-0 z-20">
            <div className="flex justify-between items-center flex-wrap gap-2.5">
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleReset}>
                  重新上传
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExport}>
                  导出 Excel
                </Button>
              </div>
              <Button
                onClick={handleSubmit}
                loading={submitting}
                disabled={liveErrors.length > 0 || submitting}
              >
                提交下单
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 步骤 4: 提交完成 */}
      {step === "submitted" && (
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] animate-fade-in overflow-hidden">
          {/* 顶部带渐变背景的成功区域 */}
          <div className="relative px-6 py-12 lg:py-16 bg-gradient-to-b from-[#f0fcfb] via-[#fafefe] to-white">
            {/* 装饰光晕（绝对定位，居中） */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[520px] h-[220px] rounded-full bg-[#0fc6c2]/[0.08] blur-3xl"
            />

            {/* 内容区：外层用 flex 居中容器，内层用 flex-col 纵向排列 */}
            <div className="relative w-full flex justify-center">
              <div className="flex flex-col items-center text-center w-full" style={{ maxWidth: 520 }}>
              {/* 成功图标 - 渐变填充 + 阴影 */}
              <div className="relative mb-6">
                {/* 外层柔和环 */}
                <div className="absolute inset-0 rounded-full bg-[#0fc6c2]/15 scale-125 blur-md" />
                {/* 主图标 */}
                <div className="relative w-[88px] h-[88px] rounded-full bg-gradient-to-br from-[#1ed7d4] to-[#0bada9] flex items-center justify-center shadow-[0_10px_28px_rgba(15,198,194,0.38),inset_0_1px_0_rgba(255,255,255,0.3)]">
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>

              {/* 标题 */}
              <h2 className="text-2xl lg:text-[26px] font-bold text-[#1d2129] mb-3 tracking-tight">
                提交成功
              </h2>

              {/* 提交结果汇总 */}
              <div className="w-full max-w-[360px] mx-auto space-y-3 mb-6">
                <div className="flex items-center gap-3 px-4 py-3 bg-[#f0fdf6] border border-[#b7eb8f] rounded-lg">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00b42a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="text-sm text-[#1d2129]">成功</span>
                  <span className="ml-auto text-base font-bold text-[#00b42a]">{submittedCount}</span>
                  <span className="text-sm text-[#4e5969]">条货品</span>
                </div>
              </div>

              {/* 聚合说明 */}
              <p className="text-sm text-[#86909c] mb-8 leading-relaxed">
                {currentRuleMode === "transfer"
                  ? "已按 调拨单 → 调拨明细 → SKU 三级聚合落库"
                  : "数据已持久化到数据库，可在「已导入运单」中查看"}
              </p>

              {/* 操作按钮 */}
              <div className="flex justify-center gap-3 flex-wrap">
                <Button onClick={handleReset}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  继续导入
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => (window.location.href = "/history")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                  查看运单列表
                </Button>
              </div>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* 规则编辑器弹窗 */}
      <Modal
        isOpen={showRuleEditor}
        onClose={() => setShowRuleEditor(false)}
        title={editingRule?.aiGenerated ? "确认 AI 生成的规则" : "新建解析规则"}
        size="xl"
      >
        <RuleEditor
          rule={editingRule}
          onSave={handleSaveRule}
          onCancel={() => setShowRuleEditor(false)}
          fileType={file?.name.endsWith(".pdf") ? "pdf" : file?.name.endsWith(".docx") ? "word" : "excel"}
          fileName={file?.name}
          aiFieldMappings={aiAnalysisResult?.fieldMappings || []}
        />
      </Modal>
    </div>
  );
}
