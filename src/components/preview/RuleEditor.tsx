"use client";

import { useState } from "react";
import { ParseRule, FieldMapping } from "@/types";
import { Button } from "@/components/ui/Button";
import { v4 as uuidv4 } from "uuid";

interface RuleEditorProps {
  rule: Partial<ParseRule> | null;
  onSave: (rule: ParseRule) => void;
  onCancel: () => void;
  fileType?: "excel" | "word" | "pdf";
  fileName?: string;
  /** AI 分析的原始字段映射信息（用于显示推测标注） */
  aiFieldMappings?: Array<{
    targetField: string;
    suggestedSource: string;
    confidence?: number;
    note?: string;
  }>;
}

// 字段的中文名和图标
const FIELD_LABELS: Record<string, { label: string; icon: string; required: boolean; placeholder: string }> = {
  externalCode: { label: "单据号", icon: "📋", required: false, placeholder: "如: 配送单号、调拨单号" },
  storeName: { label: "收货门店", icon: "🏪", required: false, placeholder: "如: 收货门店、调入方" },
  recipientName: { label: "收件人姓名", icon: "👤", required: false, placeholder: "如: 收货人、联系人" },
  recipientPhone: { label: "收件人电话", icon: "📞", required: false, placeholder: "如: 电话、手机号" },
  recipientAddress: { label: "收件人地址", icon: "📍", required: false, placeholder: "如: 收货地址" },
  skuCode: { label: "物品编码", icon: "🔢", required: true, placeholder: "如: 物品编码、SKU" },
  skuName: { label: "物品名称", icon: "📦", required: true, placeholder: "如: 物品名称、品名" },
  skuQuantity: { label: "发货数量", icon: "🔢", required: true, placeholder: "如: 数量、发货数量" },
  skuSpec: { label: "规格型号", icon: "📏", required: false, placeholder: "如: 规格、型号、单位" },
  remark: { label: "备注", icon: "📝", required: false, placeholder: "如: 备注、说明" },
};

const defaultFieldMappings: FieldMapping[] = [
  { targetField: "externalCode", mode: "column_name", columnName: "" },
  { targetField: "storeName", mode: "column_name", columnName: "" },
  { targetField: "recipientName", mode: "column_name", columnName: "" },
  { targetField: "recipientPhone", mode: "column_name", columnName: "" },
  { targetField: "recipientAddress", mode: "column_name", columnName: "" },
  { targetField: "skuCode", mode: "column_name", columnName: "", required: true },
  { targetField: "skuName", mode: "column_name", columnName: "", required: true },
  { targetField: "skuQuantity", mode: "column_name", columnName: "", required: true },
  { targetField: "skuSpec", mode: "column_name", columnName: "" },
  { targetField: "remark", mode: "column_name", columnName: "" },
];

export function RuleEditor({
  rule,
  onSave,
  onCancel,
  fileType = "excel",
  fileName = "",
  aiFieldMappings = [],
}: RuleEditorProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(rule?.name || fileName ? `${fileName} - 解析规则` : "");
  const [description, setDescription] = useState(rule?.description || "");
  const [skipRows, setSkipRows] = useState(rule?.dataRegion?.skipRows || 0);
  const [headerRow, setHeaderRow] = useState(rule?.dataRegion?.headerRow || 0);
  const [groupByExternalCode, setGroupByExternalCode] = useState(
    rule?.globalConfig?.groupByExternalCode || false
  );
  const [mappings, setMappings] = useState<FieldMapping[]>(() => {
    // 如果 rule 带有 AI 分析后的 fieldMappings（含预填 columnName），直接使用
    if (rule?.fieldMappings && rule.fieldMappings.length > 0) {
      return defaultFieldMappings.map((def) => {
        const aiMapping = rule.fieldMappings!.find(
          (m) => m.targetField === def.targetField
        );
        return aiMapping ? { ...def, ...aiMapping } : def;
      });
    }
    return defaultFieldMappings;
  });
  const [skipTotalRow, setSkipTotalRow] = useState(
    rule?.postProcessing?.skipTotalRow || false
  );
  const [totalRowPattern, setTotalRowPattern] = useState(
    rule?.postProcessing?.totalRowPattern || "合计"
  );
  const [mergeSheets, setMergeSheets] = useState(
    rule?.globalConfig?.mergeSheets || false
  );

  // 当前焦点字段（移动端分步编辑）
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const handleMappingChange = (
    targetField: string,
    field: "columnName" | "mode" | "required",
    value: string | boolean
  ) => {
    const idx = mappings.findIndex((m) => m.targetField === targetField);
    if (idx === -1) return;
    const newMappings = [...mappings];
    newMappings[idx] = { ...newMappings[idx], [field]: value };
    setMappings(newMappings);
  };

  const handleSave = () => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const fullRule: ParseRule = {
        id: (rule as ParseRule)?.id || uuidv4(),
        name: name || `${fileName || "未命名"} 解析规则`,
        description,
        fileType: rule?.fileType || fileType,
        globalConfig: {
          groupByExternalCode,
          externalCodeField: "externalCode",
          mergeSheets,
        },
        fieldMappings: mappings,
        dataRegion: {
          skipRows,
          headerRow,
        },
        postProcessing: {
          skipTotalRow,
          totalRowPattern,
        },
        createdAt: (rule as ParseRule)?.createdAt || now,
        updatedAt: now,
        aiGenerated: rule?.aiGenerated || false,
        aiConfidence: rule?.aiConfidence,
        aiNotes: rule?.aiNotes,
      };
      onSave(fullRule);
    } finally {
      setSaving(false);
    }
  };

  // 获取 AI 对该字段的分析信息
  const getAIInfo = (targetField: string) =>
    aiFieldMappings.find((fm) => fm.targetField === targetField);

  // 统计映射完成情况
  const filledCount = mappings.filter(
    (m) => m.columnName?.trim()
  ).length;
  const requiredFilled = mappings.filter(
    (m) => m.required && m.columnName?.trim()
  ).length;
  const requiredTotal = mappings.filter((m) => m.required).length;

  const isAI = rule?.aiGenerated;
  const aiConf = rule?.aiConfidence || 0;

  return (
    <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
      {/* AI 生成提示横幅 */}
      {isAI && (
        <div className={`p-3 rounded-xl border flex items-start gap-3 ${
          aiConf > 0.7
            ? "bg-gradient-to-r from-[#e8ffea] to-[#e8fafa] border-[#b5e8e8]"
            : "bg-gradient-to-r from-[#fff7e6] to-[#fffbe6] border-[#ffd591]"
        }`}>
          <span className="text-2xl shrink-0">🤖</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d2129]">
              DeepSeek 已预填字段映射
            </p>
            <p className="text-xs text-[#4e5969] mt-0.5">
              整体置信度 {Math.round(aiConf * 100)}%，已自动填入 {filledCount}/{mappings.length} 个字段。
              {aiConf < 0.7 && " 低置信度字段已标注，请重点检查。"}
            </p>
          </div>
        </div>
      )}

      {/* 规则名称 */}
      <div>
        <label className="block text-xs font-semibold text-[#1d2129] mb-1.5">规则名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入规则名称，如：XX公司出库单解析规则"
          className="w-full px-3 py-2.5 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-2 focus:ring-[#0fc6c2]/20 outline-none transition-shadow"
        />
      </div>

      {/* 字段映射 - 卡片式，每个字段一张卡片 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-[#1d2129]">字段映射</h3>
            <p className="text-xs text-[#86909c] mt-0.5">
              告诉系统每个字段对应文件中的哪一列
            </p>
          </div>
          <span className="text-xs bg-[#f2f3f5] text-[#4e5969] px-2 py-1 rounded-full">
            必填 {requiredFilled}/{requiredTotal} · 已填 {filledCount}/{mappings.length}
          </span>
        </div>

        <div className="space-y-2">
          {mappings.map((mapping) => {
            const info = FIELD_LABELS[mapping.targetField] || {
              label: mapping.targetField,
              icon: "📌",
              required: false,
              placeholder: "列名",
            };
            const aiInfo = getAIInfo(mapping.targetField);
            const conf = aiInfo?.confidence || 0;
            const isLowConf = conf > 0 && conf < 0.5;
            const isFocused = focusedField === mapping.targetField;

            return (
              <div
                key={mapping.targetField}
                className={`rounded-xl border transition-all ${
                  isFocused
                    ? "border-[#0fc6c2] shadow-[0_0_0_2px_rgba(15,198,194,0.15)] bg-white"
                    : mapping.columnName
                      ? "border-[#e5e6eb] bg-white"
                      : mapping.required
                        ? "border-[#ffece8] bg-[#fffbfa]"
                        : "border-[#e5e6eb] bg-[#fafbfc]"
                } p-3`}
                onClick={() => setFocusedField(mapping.targetField)}
              >
                {/* 字段头 */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">{info.icon}</span>
                  <span className="text-sm font-medium text-[#1d2129]">{info.label}</span>
                  {info.required && (
                    <span className="text-[#cf1322] text-xs font-bold">*必填</span>
                  )}
                  {/* AI 推断标签 */}
                  {aiInfo && (
                    <span
                      className={`ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        isLowConf
                          ? "bg-[#fff7e6] text-[#ff7d00]"
                          : conf >= 0.75
                            ? "bg-[#e8ffea] text-[#00b42a]"
                            : "bg-[#f2f3f5] text-[#86909c]"
                      }`}
                      title={aiInfo.note || `置信度: ${Math.round(conf * 100)}%`}
                    >
                      {isLowConf ? "⚠️ 推测" : conf >= 0.75 ? "✅ 确认" : "💡 参考"}
                      {" "}{Math.round(conf * 100)}%
                    </span>
                  )}
                </div>

                {/* 输入区 */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={mapping.columnName || ""}
                    onChange={(e) =>
                      handleMappingChange(mapping.targetField, "columnName", e.target.value)
                    }
                    placeholder={aiInfo?.suggestedSource || info.placeholder}
                    className={`flex-1 px-3 py-2 text-sm border rounded-lg outline-none transition-all ${
                      isLowConf
                        ? "border-[#ffd591] bg-[#fffbe6] focus:border-[#ff7d00] focus:ring-2 focus:ring-[#ff7d00]/10"
                        : "border-[#e5e6eb] focus:border-[#0fc6c2] focus:ring-2 focus:ring-[#0fc6c2]/10"
                    }`}
                    onFocus={() => setFocusedField(mapping.targetField)}
                  />
                  {!info.required && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMappingChange(mapping.targetField, "columnName", "");
                      }}
                      className={`shrink-0 text-xs px-2 py-2 rounded-lg transition-colors ${
                        mapping.columnName
                          ? "text-[#86909c] hover:text-[#cf1322] hover:bg-[#ffece8]"
                          : "text-[#c9cdd4]"
                      }`}
                      title="清除此字段"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* AI 推测说明 */}
                {aiInfo?.note && isFocused && (
                  <p className="text-[10px] text-[#86909c] mt-1.5 pl-1">
                    💡 {aiInfo.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 数据区域配置 - 折叠式 */}
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-[#1d2129] py-2 select-none">
          <svg className="w-4 h-4 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          数据区位置与高级选项
          <span className="text-xs text-[#86909c] font-normal ml-auto">可选</span>
        </summary>
        <div className="mt-2 space-y-3 pl-6">
          {/* 表头和数据起始行 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#4e5969] mb-1">
                表头行号（0开始）
              </label>
              <input
                type="number"
                value={headerRow}
                onChange={(e) => setHeaderRow(Number(e.target.value))}
                min={0}
                className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
              />
              <p className="text-[10px] text-[#86909c] mt-0.5">第1行是标题？填0</p>
            </div>
            <div>
              <label className="block text-xs text-[#4e5969] mb-1">
                跳过干扰头部行数
              </label>
              <input
                type="number"
                value={skipRows}
                onChange={(e) => setSkipRows(Number(e.target.value))}
                min={0}
                className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
              />
              <p className="text-[10px] text-[#86909c] mt-0.5">表头前的无关行</p>
            </div>
          </div>

          {/* 选项 */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input
                type="checkbox"
                checked={groupByExternalCode}
                onChange={(e) => setGroupByExternalCode(e.target.checked)}
                className="accent-[#0fc6c2] w-4 h-4"
              />
              <span className="text-sm text-[#4e5969]">按单据号聚合多行</span>
              <span className="text-xs text-[#86909c]">（同单号多物品合并为一条）</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input
                type="checkbox"
                checked={skipTotalRow}
                onChange={(e) => setSkipTotalRow(e.target.checked)}
                className="accent-[#0fc6c2] w-4 h-4"
              />
              <span className="text-sm text-[#4e5969]">跳过合计行</span>
              {skipTotalRow && (
                <input
                  type="text"
                  value={totalRowPattern}
                  onChange={(e) => setTotalRowPattern(e.target.value)}
                  className="px-2 py-0.5 text-xs border border-[#e5e6eb] rounded-lg focus:border-[#0fc6c2] outline-none w-20"
                />
              )}
            </label>

            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input
                type="checkbox"
                checked={mergeSheets}
                onChange={(e) => setMergeSheets(e.target.checked)}
                className="accent-[#0fc6c2] w-4 h-4"
              />
              <span className="text-sm text-[#4e5969]">合并所有Sheet</span>
              <span className="text-xs text-[#86909c]">（多门店分Sheet场景）</span>
            </label>
          </div>
        </div>
      </details>

      {/* 底部操作 */}
      <div className="flex items-center justify-between pt-4 border-t border-[#e5e6eb]">
        <p className="text-xs text-[#86909c]">
          完成字段映射后保存即可解析
        </p>
        <div className="flex gap-2.5">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={requiredFilled < requiredTotal}
          >
            {requiredFilled < requiredTotal
              ? `请填写 ${requiredTotal - requiredFilled} 个必填字段`
              : "保存规则"}
          </Button>
        </div>
      </div>
    </div>
  );
}
