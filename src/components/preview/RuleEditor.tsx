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
  aiFieldMappings?: Array<{
    targetField: string;
    suggestedSource: string;
    confidence?: number;
    note?: string;
  }>;
}

// 字段定义：图标 + 中文名 + 必填 + placeholder
const FIELD_DEFS = [
  { key: "skuCode", label: "物品编码", icon: "\u{1F522}", required: true, hint: "如: 物品编码、SKU、条码" },
  { key: "skuName", label: "物品名称", icon: "\u{1F4E6}", required: true, hint: "如: 物品名称、品名" },
  { key: "skuQuantity", label: "发货数量", icon: "\u{1F522}", required: true, hint: "如: 数量、件数" },
  { key: "externalCode", label: "单据号", icon: "\u{1F4CB}", required: false, hint: "如: 调拨单号、配送单号" },
  { key: "storeName", label: "收货门店", icon: "\u{1F3EA}", required: false, hint: "如: 调入门店、收货方" },
  { key: "recipientName", label: "收件人", icon: "\u{1F464}", required: false, hint: "如: 收货人、联系人" },
  { key: "recipientPhone", label: "联系电话", icon: "\u{260E}\uFE0F", required: false, hint: "如: 电话、手机" },
  { key: "recipientAddress", label: "收货地址", icon: "\u{1F4CD}", required: false, hint: "如: 收货地址、详细地址" },
  { key: "skuSpec", label: "规格型号", icon: "\u{1F4CF}", required: false, hint: "如: 规格、型号、单位" },
  { key: "remark", label: "备注", icon: "\u{1F4DD}", required: false, hint: "如: 备注、说明" },
];

const defaultMappings: FieldMapping[] = FIELD_DEFS.map((f) => ({
  targetField: f.key,
  mode: "column_name" as const,
  columnName: "",
  required: f.required,
}));

export function RuleEditor({
  rule,
  onSave,
  onCancel,
  fileType = "excel",
  fileName = "",
  aiFieldMappings = [],
}: RuleEditorProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(rule?.name || (fileName ? `${fileName} - 解析规则` : ""));
  const [skipRows, setSkipRows] = useState(rule?.dataRegion?.skipRows ?? 0);
  const [headerRow, setHeaderRow] = useState(rule?.dataRegion?.headerRow ?? 0);
  const [groupByExternalCode, setGroupByExternalCode] = useState(
    rule?.globalConfig?.groupByExternalCode ?? false
  );
  const [skipTotalRow, setSkipTotalRow] = useState(
    rule?.postProcessing?.skipTotalRow ?? false
  );

  // 核心：合并 AI 预填值到默认映射
  const [mappings, setMappings] = useState<FieldMapping[]>(() => {
    if (rule?.fieldMappings && rule.fieldMappings.length > 0) {
      return defaultMappings.map((def) => {
        const aiMap = rule!.fieldMappings!.find((m) => m.targetField === def.targetField);
        return aiMap ? { ...def, ...aiMap } : def;
      });
    }
    return defaultMappings;
  });

  // 获取某字段的 AI 信息
  const getAIInfo = (targetField: string) =>
    aiFieldMappings.find((fm) => fm.targetField === targetField);

  // 统计
  const filledCount = mappings.filter((m) => m.columnName?.trim()).length;
  const reqFields = FIELD_DEFS.filter((f) => f.required);
  const requiredFilled = mappings.filter(
    (m) => m.required && m.columnName?.trim()
  ).length;

  const isAI = !!rule?.aiGenerated;

  const handleSave = () => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const fullRule: ParseRule = {
        id: (rule as ParseRule)?.id || uuidv4(),
        name: name || `${fileName || "未命名"} 解析规则`,
        description: "",
        fileType: rule?.fileType || fileType,
        globalConfig: {
          groupByExternalCode,
          externalCodeField: "externalCode",
          mergeSheets: rule?.globalConfig?.mergeSheets || false,
        },
        fieldMappings: mappings,
        dataRegion: { skipRows, headerRow },
        postProcessing: {
          skipTotalRow,
          totalRowPattern: "合计",
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

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-0.5">
      {/* === 顶部提示横幅 === */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-[#f0fdfb] to-[#ecfeff] border border-[#99f6e4]/60">
        <span className="text-lg flex-shrink-0">{isAI ? "\u{1F916}" : "\u2699\uFE0F"}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#0d3a2c]">
            {isAI ? "DeepSeek 已分析文件并预填字段映射，请检查确认" : "请为每个目标字段选择对应的源列名"}
          </p>
          <p className="text-xs text-[#047857]/70 mt-0.5">
            已填 {filledCount}/{mappings.length} 个字段
            {requiredFilled < reqFields.length && ` · 还有 ${reqFields.length - requiredFilled} 个必填项未填`}
          </p>
        </div>
      </div>

      {/* === 规则名称（紧凑）=== */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-[#4e5969]">规则名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="给这条解析规则起个名字"
          className="w-full px-3 py-2 text-sm bg-white border border-[#e5e6eb] rounded-lg focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20 outline-none transition-all"
        />
      </div>

      {/* === 字段映射表格 === */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] overflow-hidden">
        {/* 表头 */}
        <div className="grid grid-cols-12 gap-0 px-4 py-2.5 bg-[#f7f8fa] border-b border-[#e5e6eb] text-[11px] font-semibold text-[#86909c] uppercase tracking-wide">
          <div className="col-span-4">目标字段</div>
          <div className="col-span-7">对应列名</div>
          <div className="col-span-1 text-center">状态</div>
        </div>

        {/* 行 */}
        <div className="divide-y divide-[#f2f3f5]">
          {FIELD_DEFS.map((fieldDef) => {
            const mapping = mappings.find((m) => m.targetField === fieldDef.key)!;
            const aiInfo = getAIInfo(fieldDef.key);
            const hasValue = !!mapping.columnName?.trim();
            const conf = aiInfo?.confidence || 0;
            const isLowConf = conf > 0 && conf < 0.5;

            return (
              <div
                key={fieldDef.key}
                className={`grid grid-cols-12 gap-0 px-4 py-2.5 items-center transition-colors hover:bg-[#fafbfc] ${
                  fieldDef.required && !hasValue ? "bg-[#fffbfa]" : ""
                }`}
              >
                {/* 左侧：字段名 */}
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <span className="text-sm flex-shrink-0">{fieldDef.icon}</span>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-[#1d2129]">{fieldDef.label}</span>
                    {fieldDef.required && (
                      <span className="text-[#cf1322] text-[10px] font-bold ml-1">*</span>
                    )}
                  </div>
                </div>

                {/* 中间：输入框 */}
                <div className="col-span-7 min-w-0">
                  <input
                    type="text"
                    value={mapping.columnName || ""}
                    onChange={(e) => {
                      const idx = mappings.findIndex((m) => m.targetField === fieldDef.key);
                      if (idx >= 0) {
                        const next = [...mappings];
                        next[idx] = { ...next[idx], columnName: e.target.value };
                        setMappings(next);
                      }
                    }}
                    placeholder={hasValue ? "" : fieldDef.hint}
                    className={`w-full px-2.5 py-1.5 text-sm rounded-md outline-none transition-all ${
                      isLowConf
                        ? "border border-[#ffd591] bg-[#fffbe6] focus:border-[#ff7d00] focus:ring-1 focus:ring-[#ff7d00]/15"
                        : hasValue
                          ? "border border-[#b5e8e8] bg-[#f0fdfa] text-[#0d3a2c] focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/15"
                          : "border border-[#e5e6eb] bg-white focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/10"
                    }`}
                  />
                </div>

                {/* 右侧：AI 状态标签 */}
                <div className="col-span-1 flex justify-center">
                  {hasValue ? (
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                        conf >= 0.6 ? "bg-[#e8ffea] text-[#00b42a]" : isLowConf ? "bg-[#fff7e6] text-[#ff7d00]" : "bg-[#f2f3f5] text-[#86909c]"
                      }`}
                      title={aiInfo?.note || "已填写"}
                    >
                      ✓
                    </span>
                  ) : aiInfo ? (
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#fff7e6] text-[#ff7d00] text-[10px] font-bold"
                      title={aiInfo.note}
                    >
                      !
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* === 高级选项（可折叠）=== */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-[#86909c] hover:text-[#4e5969] select-none py-1 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          高级选项（表头行 / 跳过行数 / 聚合等）
        </summary>
        <div className="mt-2.5 pl-5 space-y-2.5 pt-2 border-l-2 border-[#e5e6eb] ml-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-[#86909c]">表头行号 (0-based)</label>
              <input type="number" value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))} min={0}
                className="w-full px-2.5 py-1.5 text-sm border border-[#e5e6eb] rounded-lg outline-none focus:border-[#0fc6c2]" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-[#86909c]">跳过头部行数</label>
              <input type="number" value={skipRows} onChange={(e) => setSkipRows(Number(e.target.value))} min={0}
                className="w-full px-2.5 py-1.5 text-sm border border-[#e5e6eb] rounded-lg outline-none focus:border-[#0fc6c2]" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-[#4e5969] py-0.5">
            <input type="checkbox" checked={groupByExternalCode} onChange={(e) => setGroupByExternalCode(e.target.checked)} className="accent-[#0fc6c2] w-4 h-4" />
            按单据号聚合多行
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-[#4e5969] py-0.5">
            <input type="checkbox" checked={skipTotalRow} onChange={(e) => setSkipTotalRow(e.target.checked)} className="accent-[#0fc6c2] w-4 h-4" />
            跳过合计行
          </label>
        </div>
      </details>

      {/* === 底部操作栏 === */}
      <div className="flex items-center justify-between pt-3 border-t border-[#e5e6eb] -mx-1">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button onClick={handleSave} loading={saving} disabled={requiredFilled < reqFields.length}>
          {requiredFilled < reqFields.length ? `还需填写 ${reqFields.length - requiredFilled} 个必填项` : "\u2705 保存规则"}
        </Button>
      </div>
    </div>
  );
}
