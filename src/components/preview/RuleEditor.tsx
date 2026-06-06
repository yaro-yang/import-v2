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

// 字段定义：图标 + 中文名 + 必填 + placeholder + 分组
// A组(门店模式): 只需填写"收货门店"
// B组(收件人模式): 需填写"收件人姓名+收件人电话+收件人地址"三个
// 两组至少填一组，两组都填也可以。必填项: SKU编码/SKU名称/SKU发货数量 + (A组 or B组)
const FIELD_DEFS = [
  { key: "externalCode", label: "外部编码", icon: "doc", required: false, hint: "外部系统订单唯一编号，用于去重和聚合（如配送单号）", group: null as string | null },
  { key: "storeName", label: "收货门店", icon: "store", required: false, hint: "收货门店/机构名称（如\"尹三顺自助烤肉（银泰店）\"）", group: "A" as string | null },
  { key: "recipientName", label: "收件人姓名", icon: "user", required: false, hint: "收货人姓名", group: "B" as string | null },
  { key: "recipientPhone", label: "收件人电话", icon: "phone", required: false, hint: "收货人联系方式", group: "B" as string | null },
  { key: "recipientAddress", label: "收件人地址", icon: "location", required: false, hint: "收货人完整地址", group: "B" as string | null },
  { key: "skuCode", label: "SKU物品编码", icon: "code", required: true, hint: "SKU 唯一编码", group: null as string | null },
  { key: "skuName", label: "SKU物品名称", icon: "box", required: true, hint: "SKU 名称", group: null as string | null },
  { key: "skuQuantity", label: "SKU发货数量", icon: "count", required: true, hint: "发货数量，必须为正数", group: null as string | null },
  { key: "skuSpec", label: "SKU规格型号", icon: "spec", required: false, hint: "物品规格描述", group: null as string | null },
  { key: "remark", label: "备注", icon: "note", required: false, hint: "附加说明", group: null as string | null },
];

// 字段图标（统一 SVG 线条风格）
function FieldIcon({ name }: { name: string }) {
  const common = "w-3.5 h-3.5";
  switch (name) {
    case "code":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "box":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );
    case "count":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" />
        </svg>
      );
    case "doc":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" />
        </svg>
      );
    case "store":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <path d="M3 9l1-4h16l1 4" /><path d="M5 9v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M9 22V12h6v10" />
        </svg>
      );
    case "user":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "phone":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case "location":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
        </svg>
      );
    case "spec":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      );
    case "note":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    default:
      return null;
  }
}

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
  // A组(门店模式): storeName
  // B组(收件人模式): recipientName + recipientPhone + recipientAddress
  const aGroupFilled = mappings.find((m) => m.targetField === "storeName")?.columnName?.trim() ? true : false;
  const bGroupFields = ["recipientName", "recipientPhone", "recipientAddress"];
  const bGroupFilled = bGroupFields.every((k) => mappings.find((m) => m.targetField === k)?.columnName?.trim());
  const abGroupOk = aGroupFilled || bGroupFilled;

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
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {/* === 顶部提示横幅 === */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-gradient-to-r from-[#f0fdfd] to-[#e8fafa] border border-[#0fc6c2]/25">
        <div className="w-9 h-9 rounded-lg bg-[#0fc6c2]/10 flex items-center justify-center flex-shrink-0 text-[#0fc6c2]">
          {isAI ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#0d3a2c]">
            {isAI ? "DeepSeek 已分析文件并预填字段映射，请检查确认" : "请为每个目标字段选择对应的源列名"}
          </p>
          <p className="text-xs text-[#4e5969] mt-1">
            已填 <span className="font-semibold text-[#0fc6c2]">{filledCount}</span>
            <span className="text-[#86909c]">/{mappings.length}</span> 个字段
            {!abGroupOk && (
              <span className="text-[#cf1322] ml-2">
                · A组(收货门店)或B组(收件人信息)至少需填一组
              </span>
            )}
            {requiredFilled < reqFields.length && (
              <span className="text-[#cf1322] ml-2">
                · 还有 {reqFields.length - requiredFilled} 个必填项未填
              </span>
            )}
          </p>
        </div>
      </div>

      {/* === 规则名称 === */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-[#4e5969]">规则名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="给这条解析规则起个名字"
          className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#e5e6eb] rounded-lg focus:border-[#0fc6c2] focus:ring-2 focus:ring-[#0fc6c2]/15 outline-none transition-all"
        />
      </div>

      {/* === 字段映射表格 === */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] overflow-hidden">
        {/* A组/B组说明 */}
        <div className="px-4 py-3 bg-gradient-to-r from-[#fffbf0] to-[#fff8e6] border-b border-[#ffe7ba]/60">
          <p className="text-xs font-semibold text-[#8c6a00] mb-1.5">A组 vs B组（二选一必填）</p>
          <div className="space-y-1 text-xs text-[#8c6a00]">
            <p><span className="font-semibold">A组（门店模式）</span>：只需填写&ldquo;收货门店&rdquo;，不要求收件人姓名/电话/地址</p>
            <p><span className="font-semibold">B组（收件人模式）</span>：需填写&ldquo;收件人姓名 + 收件人电话 + 收件人地址&rdquo;三个字段，不要求收货门店</p>
            <p className="text-[#b58b00] mt-1">两组都填也可以，但至少填一组。两组都没填则校验不通过。</p>
          </div>
        </div>
        {/* 表头 */}
        <div className="grid grid-cols-12 gap-3 px-4 py-2.5 bg-[#fafbfc] border-b border-[#e5e6eb]">
          <div className="col-span-4 text-xs font-semibold text-[#86909c]">目标字段</div>
          <div className="col-span-6 text-xs font-semibold text-[#86909c]">对应列名</div>
          <div className="col-span-2 text-right text-xs font-semibold text-[#86909c]">状态</div>
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
                className={`grid grid-cols-12 gap-3 px-4 py-2.5 items-center transition-colors hover:bg-[#fafbfc] ${
                  fieldDef.required && !hasValue ? "bg-[#fffbfb]" : ""
                }`}
              >
                {/* 左侧：字段名 + 分组标签 */}
                <div className="col-span-4 flex items-center gap-2.5 min-w-0">
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                    fieldDef.required ? "bg-[#e8fafa] text-[#0fc6c2]" : "bg-[#f7f8fa] text-[#86909c]"
                  }`}>
                    <FieldIcon name={fieldDef.icon} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium text-[#1d2129] truncate">
                        {fieldDef.label}
                      </span>
                      {fieldDef.required && (
                        <span className="text-[#cf1322] text-xs font-bold flex-shrink-0">*</span>
                      )}
                      {fieldDef.group === "A" && (
                        <span className="text-[10px] font-medium bg-[#e8ffea] text-[#00b42a] px-1.5 py-px rounded flex-shrink-0">A组</span>
                      )}
                      {fieldDef.group === "B" && (
                        <span className="text-[10px] font-medium bg-[#fff7e6] text-[#ff7d00] px-1.5 py-px rounded flex-shrink-0">B组</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 中间：输入框 + AI 提示 */}
                <div className="col-span-6 min-w-0">
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
                    className={`w-full px-3 py-1.5 text-sm rounded-md outline-none transition-all bg-white border ${
                      isLowConf
                        ? "border-[#ffd591] focus:border-[#ff7d00] focus:ring-1 focus:ring-[#ff7d00]/15"
                        : "border-[#e5e6eb] focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/15"
                    }`}
                  />
                  {aiInfo && (
                    <p className="text-[11px] text-[#86909c] mt-1 leading-tight truncate">
                      AI 推断
                      {conf > 0 && (
                        <span className={`ml-1 ${
                          conf >= 0.8 ? "text-[#00b42a]" : conf >= 0.5 ? "text-[#0fc6c2]" : "text-[#ff7d00]"
                        }`}>
                          · 置信度 {(conf * 100).toFixed(0)}%
                        </span>
                      )}
                      {aiInfo.note && <span className="ml-1">· {aiInfo.note}</span>}
                    </p>
                  )}
                </div>

                {/* 右侧：状态 */}
                <div className="col-span-2 flex justify-end">
                  {hasValue ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
                        conf >= 0.5
                          ? "bg-[#e8ffea] text-[#00b42a]"
                          : "bg-[#fff7e6] text-[#ff7d00]"
                      }`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {conf >= 0.5 ? "已填" : "低置信"}
                    </span>
                  ) : aiInfo ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-[#fff7e6] text-[#ff7d00]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      待确认
                    </span>
                  ) : (
                    <span className="text-xs text-[#c9cdd4]">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* === 高级选项（可折叠）=== */}
      <details className="group bg-white rounded-xl border border-[#e5e6eb] overflow-hidden">
        <summary className="cursor-pointer text-sm font-medium text-[#4e5969] hover:text-[#0fc6c2] select-none py-3 px-4 flex items-center gap-2 transition-colors">
          <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          高级选项
          <span className="text-xs text-[#86909c] font-normal">（表头行 / 跳过行数 / 聚合等）</span>
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-3 border-t border-[#f2f3f5] bg-[#fafbfc]">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-[#4e5969]">表头行号 <span className="text-[#86909c]">(0-based)</span></label>
              <input
                type="number"
                value={headerRow}
                onChange={(e) => setHeaderRow(Number(e.target.value))}
                min={0}
                className="w-full px-3 py-1.5 text-sm border border-[#e5e6eb] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/15 bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-[#4e5969]">跳过头部行数</label>
              <input
                type="number"
                value={skipRows}
                onChange={(e) => setSkipRows(Number(e.target.value))}
                min={0}
                className="w-full px-3 py-1.5 text-sm border border-[#e5e6eb] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/15 bg-white"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5 pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-[#4e5969] hover:text-[#1d2129] py-1">
              <input
                type="checkbox"
                checked={groupByExternalCode}
                onChange={(e) => setGroupByExternalCode(e.target.checked)}
                className="accent-[#0fc6c2] w-4 h-4 rounded"
              />
              按单据号聚合多行
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-[#4e5969] hover:text-[#1d2129] py-1">
              <input
                type="checkbox"
                checked={skipTotalRow}
                onChange={(e) => setSkipTotalRow(e.target.checked)}
                className="accent-[#0fc6c2] w-4 h-4 rounded"
              />
              跳过合计行
            </label>
          </div>
        </div>
      </details>

      {/* === 底部操作栏 === */}
      <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#e5e6eb] sticky bottom-0 bg-white -mx-1 px-1">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button
          onClick={handleSave}
          loading={saving}
          disabled={requiredFilled < reqFields.length || !abGroupOk}
        >
          {requiredFilled < reqFields.length
            ? `还需填写 ${reqFields.length - requiredFilled} 个必填项`
            : !abGroupOk
            ? "A组或B组至少需填一组"
            : "保存规则"}
        </Button>
      </div>
    </div>
  );
}
