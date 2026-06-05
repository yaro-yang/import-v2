"use client";

import { useState, useEffect } from "react";
import { ParseRule, FieldMapping, FieldMappingMode } from "@/types";
import { Button } from "@/components/ui/Button";
import { v4 as uuidv4 } from "uuid";

interface RuleEditorProps {
  rule: Partial<ParseRule> | null;
  onSave: (rule: ParseRule) => void;
  onCancel: () => void;
  fileType?: "excel" | "word" | "pdf";
  fileName?: string;
}

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
}: RuleEditorProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(rule?.name || "");
  const [description, setDescription] = useState(rule?.description || "");
  const [skipRows, setSkipRows] = useState(rule?.dataRegion?.skipRows || 0);
  const [headerRow, setHeaderRow] = useState(rule?.dataRegion?.headerRow || 0);
  const [groupByExternalCode, setGroupByExternalCode] = useState(
    rule?.globalConfig?.groupByExternalCode || false
  );
  const [mappings, setMappings] = useState<FieldMapping[]>(
    rule?.fieldMappings || defaultFieldMappings
  );
  const [skipTotalRow, setSkipTotalRow] = useState(
    rule?.postProcessing?.skipTotalRow || false
  );
  const [totalRowPattern, setTotalRowPattern] = useState(
    rule?.postProcessing?.totalRowPattern || "合计"
  );

  const handleMappingChange = (
    index: number,
    field: keyof FieldMapping,
    value: string | number | boolean
  ) => {
    const newMappings = [...mappings];
    newMappings[index] = { ...newMappings[index], [field]: value };
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

  return (
    <div className="space-y-6">
      {/* 基本信息 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[#1d2129]">基本信息</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#4e5969] mb-1">规则名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入规则名称"
              className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[#4e5969] mb-1">文件类型</label>
            <input
              type="text"
              value={fileType.toUpperCase()}
              disabled
              className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl bg-[#f7f8fa] text-[#86909c]"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-[#4e5969] mb-1">描述（可选）</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="规则描述..."
            rows={2}
            className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none resize-none"
          />
        </div>
      </div>

      {/* 数据区配置 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[#1d2129]">数据区配置</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          </div>
          <div>
            <label className="block text-xs text-[#4e5969] mb-1">
              表头行（0-based）
            </label>
            <input
              type="number"
              value={headerRow}
              onChange={(e) => setHeaderRow(Number(e.target.value))}
              min={0}
              className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={groupByExternalCode}
                onChange={(e) => setGroupByExternalCode(e.target.checked)}
                className="accent-[#0fc6c2]"
              />
              <span className="text-sm text-[#4e5969]">按外部编码聚合</span>
            </label>
          </div>
        </div>
      </div>

      {/* 额外处理 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[#1d2129]">额外处理</h3>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={skipTotalRow}
              onChange={(e) => setSkipTotalRow(e.target.checked)}
              className="accent-[#0fc6c2]"
            />
            <span className="text-sm text-[#4e5969]">跳过合计行</span>
          </label>
          {skipTotalRow && (
            <input
              type="text"
              value={totalRowPattern}
              onChange={(e) => setTotalRowPattern(e.target.value)}
              placeholder="合计行匹配模式"
              className="px-3 py-1.5 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] outline-none w-40"
            />
          )}
        </div>
      </div>

      {/* 字段映射 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1d2129]">字段映射</h3>
          {rule?.aiGenerated && (
            <span className="text-xs bg-[#e8fafa] text-[#0b6e6e] px-2 py-0.5 rounded-full">
              🤖 AI 生成
            </span>
          )}
        </div>
        <div className="border border-[#e5e6eb] rounded-xl overflow-hidden">
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 bg-[#f7f8fa] border-b border-[#e5e6eb] text-xs font-semibold text-[#4e5969]">
            <div className="col-span-4 lg:col-span-3">目标字段</div>
            <div className="col-span-4 lg:col-span-3">映射模式</div>
            <div className="col-span-3 lg:col-span-4">列名/值</div>
            <div className="col-span-1 lg:col-span-2">必填</div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {mappings.map((mapping, index) => (
              <div
                key={index}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 px-3 lg:px-4 py-2.5 sm:py-2 border-b border-[#f2f3f5] text-sm"
              >
                <div className="sm:col-span-4 lg:col-span-3 flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#4e5969] sm:hidden">目标字段：</span>
                  <span className="text-[#1d2129] font-medium">
                    {mapping.targetField}
                  </span>
                  {mapping.required && (
                    <span className="text-[#cf1322] ml-1">*</span>
                  )}
                </div>
                <div className="sm:col-span-4 lg:col-span-3">
                  <span className="text-xs font-semibold text-[#4e5969] sm:hidden">映射模式：</span>
                  <select
                    value={mapping.mode}
                    onChange={(e) =>
                      handleMappingChange(index, "mode", e.target.value)
                    }
                    className="w-full px-2 py-1 text-xs border border-[#e5e6eb] rounded focus:border-[#0fc6c2] outline-none bg-white"
                  >
                    <option value="column_name">列名匹配</option>
                    <option value="column_index">列索引</option>
                    <option value="static_value">静态值</option>
                    <option value="tail_extract">尾部提取</option>
                    <option value="ai_infer">AI 推断</option>
                  </select>
                </div>
                <div className="sm:col-span-3 lg:col-span-4">
                  <span className="text-xs font-semibold text-[#4e5969] sm:hidden">列名/值：</span>
                  {mapping.mode === "column_index" ? (
                    <input
                      type="number"
                      value={mapping.columnIndex || ""}
                      onChange={(e) =>
                        handleMappingChange(
                          index,
                          "columnIndex",
                          Number(e.target.value)
                        )
                      }
                      placeholder="列索引"
                      className="w-full px-2 py-1 text-xs border border-[#e5e6eb] rounded focus:border-[#0fc6c2] outline-none"
                    />
                  ) : mapping.mode === "static_value" ? (
                    <input
                      type="text"
                      value={mapping.staticValue || ""}
                      onChange={(e) =>
                        handleMappingChange(index, "staticValue", e.target.value)
                      }
                      placeholder="静态值"
                      className="w-full px-2 py-1 text-xs border border-[#e5e6eb] rounded focus:border-[#0fc6c2] outline-none"
                    />
                  ) : (
                    <input
                      type="text"
                      value={mapping.columnName || ""}
                      onChange={(e) =>
                        handleMappingChange(index, "columnName", e.target.value)
                      }
                      placeholder="列名"
                      className="w-full px-2 py-1 text-xs border border-[#e5e6eb] rounded focus:border-[#0fc6c2] outline-none"
                    />
                  )}
                </div>
                <div className="sm:col-span-1 lg:col-span-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#4e5969] sm:hidden">必填：</span>
                  <input
                    type="checkbox"
                    checked={mapping.required || false}
                    onChange={(e) =>
                      handleMappingChange(index, "required", e.target.checked)
                    }
                    className="accent-[#0fc6c2]"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI 分析说明 */}
      {rule?.aiNotes && (
        <div className="p-3 bg-[#e8fafa] border border-[#b5e8e8] rounded-xl">
          <p className="text-sm font-semibold text-[#0b6e6e] mb-1">
            🤖 AI 分析说明
          </p>
          <p className="text-xs text-[#4e5969]">{rule.aiNotes}</p>
          {rule.aiConfidence !== undefined && (
            <p className="text-xs text-[#86909c] mt-1">
              置信度: {(rule.aiConfidence * 100).toFixed(0)}%
            </p>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e6eb]">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button onClick={handleSave} loading={saving}>
          保存规则
        </Button>
      </div>
    </div>
  );
}
