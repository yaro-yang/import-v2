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

  // 新建规则：触发 AI 预分析，然后打开编辑器让用户确认
  const handleCreateNewRule = useCallback(async () => {
    if (!file) return;

    setAiAnalyzing(true);
    setAiAnalysisResult(null);
    const toastId = toast.loading("🤖 DeepSeek 正在分析文件结构，生成推荐解析规则...");
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
        // AI 分析失败，打开空规则编辑器
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

      // 保存成功：先刷新列表（独立 try-catch，刷新失败不影响主流程）
      toast.success("规则保存成功");
      setSelectedRuleId(rule.id);
      try {
        const rulesRes = await fetch("/api/rules");
        const rulesData = await rulesRes.json();
        if (rulesData.success) {
          setRules(rulesData.data);
        }
      } catch (refreshErr) {
        // 刷新失败不影响保存结果，规则已写入数据库
        console.warn("Refresh rules after save failed:", refreshErr);
      }
      setShowRuleEditor(false);
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
        toast.success(
          `成功提交 ${data.data.savedOutbounds} 张出库单（${data.data.savedCount} 条 SKU）！`,
          { id: toastId }
        );
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

          {/* 规则选择卡片 - 用户手动选择已有规则或点击"新建规则"触发 AI 分析 */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5 mt-3 lg:mt-4">
            <RuleSelector
              rules={rules}
              selectedRuleId={selectedRuleId}
              onSelectRule={setSelectedRuleId}
              onCreateNew={handleCreateNewRule}
              loading={false}
            />
          </div>

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
        <div className="animate-fade-in space-y-4 lg:space-y-4.5">
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
            <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5">
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
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-10 lg:p-14 animate-fade-in">
          <div className="text-center max-w-md mx-auto">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#e8fafa] to-[#d4f5f3] flex items-center justify-center mx-auto mb-4 shadow-[0_4px_16px_rgba(15,198,194,0.2)]">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0fc6c2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-[#1d2129] mb-2">
              提交成功！
            </h2>
            <p className="text-sm text-[#4e5969] mb-6 leading-relaxed">
              已成功提交{" "}
              <span className="font-semibold text-[#0fc6c2] text-base">{submittedCount}</span>{" "}
              条 SKU 数据（按外部编码已自动聚合成出库单）
            </p>
            <div className="flex justify-center gap-2.5 flex-wrap">
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
          aiFieldMappings={aiAnalysisResult?.fieldMappings || []}
        />
      </Modal>
    </div>
  );
}
