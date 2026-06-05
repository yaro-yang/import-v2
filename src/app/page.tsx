"use client";

import { useState, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { FileUploader } from "@/components/upload/FileUploader";
import { RuleSelector } from "@/components/upload/RuleSelector";
import { DataPreviewTable } from "@/components/preview/DataPreviewTable";
import { RuleEditor } from "@/components/preview/RuleEditor";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import {
  ParseRule,
  OrderItem,
  ParseResult,
  AIAnalyzeResponse,
  ValidationError,
} from "@/types";
import { formatFileSize, formatTime, exportToExcel } from "@/lib/utils";

type Step = "upload" | "select-rule" | "preview" | "submitted";

export default function HomePage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseTime, setParseTime] = useState(0);
  const [submittedCount, setSubmittedCount] = useState(0);

  // 提交按钮防重复
  const [submitting, setSubmitting] = useState(false);

  // 规则编辑器状态
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<ParseRule> | null>(
    null
  );
  const [aiAnalysisResult, setAiAnalysisResult] =
    useState<AIAnalyzeResponse | null>(null);

  // 文件选择
  const handleFileSelect = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setStep("select-rule");
      setOrders([]);
      setErrors([]);

      // 加载已有规则
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

  // 新建规则
  const handleCreateNewRule = useCallback(async () => {
    if (!file) return;

    setLoading(true);
    const toastId = toast.loading("AI 正在分析文件...");
    try {
      // 调用 AI 分析
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
        toast.success("AI 已完成分析，请确认并调整规则", { id: toastId });
      } else {
        // AI 分析失败，打开空规则编辑器
        setEditingRule({
          fileType:
            file.name.endsWith(".pdf")
              ? "pdf"
              : file.name.endsWith(".docx")
                ? "word"
                : "excel",
        });
        toast("AI 分析不可用，请手动配置规则", { id: toastId, icon: "⚠️" });
      }
      setShowRuleEditor(true);
    } catch (err) {
      console.error("AI analysis failed:", err);
      setEditingRule({
        fileType:
          file.name.endsWith(".pdf")
            ? "pdf"
            : file.name.endsWith(".docx")
              ? "word"
              : "excel",
      });
      setShowRuleEditor(true);
      toast.error("AI 分析失败，请手动配置规则", { id: toastId });
    } finally {
      setLoading(false);
    }
  }, [file]);

  // 保存规则
  const handleSaveRule = useCallback(
    async (rule: ParseRule) => {
      try {
        const res = await fetch("/api/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rule),
        });
        const data = await res.json();

        if (data.success) {
          toast.success("规则保存成功");
          setSelectedRuleId(rule.id);
          setShowRuleEditor(false);
          // 重新加载规则列表
          const rulesRes = await fetch("/api/rules");
          const rulesData = await rulesRes.json();
          if (rulesData.success) {
            setRules(rulesData.data);
          }
        } else {
          toast.error(data.error || "保存失败");
        }
      } catch (err) {
        console.error("Save rule error:", err);
        toast.error("保存规则失败");
      }
    },
    []
  );

  // 执行解析
  const handleParse = useCallback(async () => {
    if (!file || !selectedRuleId) {
      toast.error("请选择文件和解析规则");
      return;
    }

    setLoading(true);
    setParseProgress(0);
    const startTime = performance.now();
    const toastId = toast.loading("正在解析文件...");

    // 模拟进度
    const progressInterval = setInterval(() => {
      setParseProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 20;
      });
    }, 300);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ruleId", selectedRuleId);

      const res = await fetch("/api/parse", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      clearInterval(progressInterval);
      setParseProgress(100);

      if (data.success && data.data) {
        const result: ParseResult = data.data;
        setOrders(result.orders);
        setErrors(result.errors || []);
        setParseTime(performance.now() - startTime);
        setStep("preview");

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
      } else {
        toast.error(data.error || "解析失败", { id: toastId });
      }
    } catch (err) {
      clearInterval(progressInterval);
      console.error("Parse error:", err);
      toast.error("解析失败，请检查文件格式和解析规则", { id: toastId });
    } finally {
      setLoading(false);
    }
  }, [file, selectedRuleId]);

  // 更新订单数据
  const handleUpdateOrder = useCallback(
    (id: string, field: string, value: string) => {
      setOrders((prev) =>
        prev.map((order) =>
          order.id === id
            ? {
                ...order,
                [field]:
                  field === "skuQuantity" ? parseFloat(value) || 0 : value,
                errors: undefined,
                status: "draft",
              }
            : order
        )
      );
    },
    []
  );

  // 删除订单
  const handleDeleteOrder = useCallback((id: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }, []);

  // 新增行
  const handleAddRow = useCallback(() => {
    const newOrder: OrderItem = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      skuCode: "",
      skuName: "",
      skuQuantity: 0,
      status: "draft",
      sourceFile: file?.name || "",
      createdAt: new Date().toISOString(),
    };
    setOrders((prev) => [...prev, newOrder]);
  }, [file]);

  // 提交下单
  const handleSubmit = useCallback(async () => {
    if (submitting) return; // 防重复点击
    if (errors.length > 0) {
      toast.error("请先修正所有错误后再提交");
      return;
    }

    if (orders.length === 0) {
      toast.error("没有可提交的数据");
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading("正在提交订单...");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });
      const data = await res.json();

      if (data.success) {
        setSubmittedCount(data.data.savedCount);
        setStep("submitted");
        toast.success(`成功提交 ${data.data.savedCount} 条运单！`, { id: toastId });
      } else {
        toast.error(data.error || "提交失败", { id: toastId });
      }
    } catch (err) {
      console.error("Submit error:", err);
      toast.error("提交失败", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  }, [orders, errors, submitting]);

  // 导出 Excel
  const handleExport = useCallback(() => {
    const exportData = orders.map((order) => ({
      外部编码: order.externalCode || "",
      收货门店: order.storeName || "",
      收件人: order.recipientName || "",
      电话: order.recipientPhone || "",
      地址: order.recipientAddress || "",
      SKU编码: order.skuCode,
      SKU名称: order.skuName,
      发货数量: order.skuQuantity,
      规格型号: order.skuSpec || "",
      备注: order.remark || "",
    }));
    exportToExcel(exportData, `出库单_${new Date().toLocaleDateString()}.xlsx`);
    toast.success("导出成功");
  }, [orders]);

  // 重新上传
  const handleReset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setSelectedRuleId(null);
    setOrders([]);
    setErrors([]);
    setParseProgress(0);
    setParseTime(0);
    setSubmittedCount(0);
  }, []);

  return (
    <div className="max-w-[1400px] mx-auto px-5 lg:px-8 py-5 lg:py-8 space-y-4 lg:space-y-5 page-container">
      {/* 步骤指示器 - 卡片式 */}
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5">
        <div className="flex items-center gap-1 lg:gap-2 flex-wrap">
          {[
            { key: "upload", label: "上传文件" },
            { key: "select-rule", label: "选择规则" },
            { key: "preview", label: "预览编辑" },
            { key: "submitted", label: "提交完成" },
          ].map((s, i) => {
            const stepKeys: Step[] = ["upload", "select-rule", "preview", "submitted"];
            const currentIndex = stepKeys.indexOf(step);
            const isActive = currentIndex >= i;
            const isCurrent = currentIndex === i;

            return (
              <div key={s.key} className="flex items-center gap-1 lg:gap-2">
                {i > 0 && (
                  <div
                    className={`w-6 lg:w-10 h-[2px] ${
                      isActive ? "bg-[#0fc6c2]" : "bg-[#d0d7de]"
                    }`}
                  />
                )}
                <div
                  className={`flex items-center gap-1.5 lg:gap-2 px-2.5 lg:px-4 py-1.5 lg:py-2 rounded-lg text-xs lg:text-sm font-medium transition-colors step-indicator-sm ${
                    isCurrent
                      ? "bg-[#0fc6c2] text-white"
                      : isActive
                        ? "bg-[#e8fafa] text-[#0fc6c2]"
                        : "bg-[#f2f3f5] text-[#86909c]"
                  }`}
                >
                  {isActive && !isCurrent ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <span className="w-3.5 h-3.5 lg:w-4 lg:h-4 rounded-full border flex items-center justify-center text-[9px] lg:text-[10px] leading-none">
                      {i + 1}
                    </span>
                  )}
                  <span className="whitespace-nowrap">{s.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 步骤 1: 上传文件 */}
      {step === "upload" && (
        <div key="upload" className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-5 lg:p-8 animate-fade-in card-padding-sm">
          <FileUploader onFileSelect={handleFileSelect} />
        </div>
      )}

      {/* 步骤 2: 选择规则 */}
      {step === "select-rule" && file && (
        <div className="animate-fade-in space-y-4 lg:space-y-5">
          {/* 文件信息卡片 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5">
            <div className="flex items-center gap-3 lg:gap-4">
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
              <Button variant="ghost" size="sm" onClick={handleReset}>
                更换文件
              </Button>
            </div>
          </div>

          {/* 规则选择卡片 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-6">
            <RuleSelector
              rules={rules}
              selectedRuleId={selectedRuleId}
              onSelectRule={setSelectedRuleId}
              onCreateNew={handleCreateNewRule}
              loading={loading}
            />
          </div>

          {/* 操作栏卡片 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5">
            <div className="flex items-center justify-end gap-3">
              <Button
                onClick={handleParse}
                loading={loading}
                disabled={!selectedRuleId}
              >
                开始解析
              </Button>
            </div>

            {/* 进度条 */}
            {loading && parseProgress > 0 && (
              <div className="mt-4">
                <ProgressBar
                  progress={parseProgress}
                  label="正在解析文件..."
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 步骤 3: 预览编辑 */}
      {step === "preview" && (
        <div className="animate-fade-in space-y-4 lg:space-y-5">
          {/* 统计信息卡片 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5">
            <div className="flex items-center gap-4 lg:gap-8 flex-wrap">
              <div>
                <p className="text-sm text-[#86909c] mb-1">总数据</p>
                <p className="text-2xl font-semibold text-[#1d2129]">
                  {orders.length} 条
                </p>
              </div>
              <div className="w-[1px] h-12 bg-[#e5e6eb] hidden sm:block" />
              <div>
                <p className="text-sm text-[#86909c] mb-1">解析耗时</p>
                <p className="text-2xl font-semibold text-[#0fc6c2]">
                  {formatTime(parseTime)}
                </p>
              </div>
              {errors.length > 0 && (
                <>
                  <div className="w-[1px] h-12 bg-[#e5e6eb] hidden sm:block" />
                  <div>
                    <p className="text-sm text-[#86909c] mb-1">校验错误</p>
                    <p className="text-2xl font-bold text-[#cf1322]">
                      {errors.length} 个
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 数据预览表格卡片 */}
          {orders.length > 0 ? (
            <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-6">
              <DataPreviewTable
                orders={orders}
                onUpdateOrder={handleUpdateOrder}
                onDeleteOrder={handleDeleteOrder}
                onAddRow={handleAddRow}
                errors={errors}
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

          {/* 操作按钮卡片 - 关键操作始终可见 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5 sticky bottom-0 z-20">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleReset}>
                  重新上传
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExport}>
                  导出 Excel
                </Button>
              </div>
              <Button
                size="lg"
                onClick={handleSubmit}
                loading={submitting}
                disabled={errors.length > 0 || submitting}
              >
                提交下单
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 步骤 4: 提交完成 */}
      {step === "submitted" && (
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-10 lg:p-16 animate-fade-in">
          <div className="text-center">
            <div className="w-16 h-16 lg:w-18 lg:h-18 rounded-full bg-[#e8fafa] flex items-center justify-center mx-auto mb-5">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0fc6c2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-[#1d2129] mb-2">
              提交成功！
            </h2>
            <p className="text-base text-[#4e5969] mb-6">
              已成功提交{" "}
              <span className="font-semibold text-[#0fc6c2]">{submittedCount}</span>{" "}
              条运单
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              <Button onClick={handleReset}>继续导入</Button>
              <Button
                variant="secondary"
                onClick={() => (window.location.href = "/history")}
              >
                查看运单列表
              </Button>
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
        />
      </Modal>
    </div>
  );
}
