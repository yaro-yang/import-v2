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
  // 高级解析模式
  const [matrixMode, setMatrixMode] = useState(
    rule?.dataRegion?.matrixMode?.enabled || false
  );
  const [cardMode, setCardMode] = useState(
    rule?.dataRegion?.cardMode?.enabled || false
  );
  const [cardStartMarker, setCardStartMarker] = useState(
    rule?.dataRegion?.cardMode?.startMarker || ""
  );
  const [compositeMode, setCompositeMode] = useState(
    rule?.dataRegion?.compositeMode?.enabled || false
  );
  const [compositeSeparator, setCompositeSeparator] = useState(
    rule?.dataRegion?.compositeMode?.separator || "\n"
  );
  const [mergeSheets, setMergeSheets] = useState(
    rule?.globalConfig?.mergeSheets || false
  );
  // Word/PDF 文本解析
  const [textRecordMarker, setTextRecordMarker] = useState(
    rule?.postProcessing?.textRecordMarker || ""
  );
  const [textSeparator, setTextSeparator] = useState(
    rule?.postProcessing?.textSeparator || ""
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
          mergeSheets,
        },
        fieldMappings: mappings,
        dataRegion: {
          skipRows,
          headerRow,
          cardMode: cardMode
            ? { enabled: true, startMarker: cardStartMarker }
            : undefined,
          matrixMode: matrixMode
            ? { enabled: true }
            : undefined,
          compositeMode: compositeMode
            ? { enabled: true, separator: compositeSeparator, pattern: "(.+?)x(\\d+)" }
            : undefined,
        },
        postProcessing: {
          skipTotalRow,
          totalRowPattern,
          textRecordMarker: textRecordMarker || undefined,
          textSeparator: textSeparator || undefined,
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

      {/* 高级解析模式 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[#1d2129]">高级解析模式</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* 矩阵转置 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={matrixMode}
              onChange={(e) => setMatrixMode(e.target.checked)}
              className="accent-[#0fc6c2]"
            />
            <span className="text-sm text-[#4e5969]">矩阵转置模式</span>
            <span className="text-xs text-[#86909c]">（SKU×门店矩阵）</span>
          </label>

          {/* 卡片式布局 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cardMode}
              onChange={(e) => setCardMode(e.target.checked)}
              className="accent-[#0fc6c2]"
            />
            <span className="text-sm text-[#4e5969]">卡片式布局</span>
            <span className="text-xs text-[#86909c]">（调拨记录卡片）</span>
          </label>
          {cardMode && (
            <div className="sm:col-span-2">
              <label className="block text-xs text-[#4e5969] mb-1">卡片起始标志</label>
              <input
                type="text"
                value={cardStartMarker}
                onChange={(e) => setCardStartMarker(e.target.value)}
                placeholder="如：▶ 调拨记录"
                className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
              />
            </div>
          )}

          {/* 复合单元格拆分 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={compositeMode}
              onChange={(e) => setCompositeMode(e.target.checked)}
              className="accent-[#0fc6c2]"
            />
            <span className="text-sm text-[#4e5969]">复合单元格拆分</span>
            <span className="text-xs text-[#86909c]">（物品名x数量）</span>
          </label>
          {compositeMode && (
            <div>
              <label className="block text-xs text-[#4e5969] mb-1">分隔符</label>
              <input
                type="text"
                value={compositeSeparator}
                onChange={(e) => setCompositeSeparator(e.target.value)}
                placeholder="默认换行符 \\n"
                className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
              />
            </div>
          )}

          {/* 合并所有Sheet */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mergeSheets}
              onChange={(e) => setMergeSheets(e.target.checked)}
              className="accent-[#0fc6c2]"
            />
            <span className="text-sm text-[#4e5969]">合并所有Sheet</span>
            <span className="text-xs text-[#86909c]">（多门店分Sheet）</span>
          </label>
        </div>
      </div>

      {/* Word/PDF 文本解析配置 */}
      {(fileType === "word" || fileType === "pdf") && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[#1d2129]">文本解析配置</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#4e5969] mb-1">记录分隔标志</label>
              <input
                type="text"
                value={textRecordMarker}
                onChange={(e) => setTextRecordMarker(e.target.value)}
                placeholder="如：━━━"
                className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-[#4e5969] mb-1">文本分隔符</label>
              <input
                type="text"
                value={textSeparator}
                onChange={(e) => setTextSeparator(e.target.value)}
                placeholder="如：|"
                className="w-full px-3 py-2 text-sm border border-[#e5e6eb] rounded-xl focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
              />
            </div>
          </div>
        </div>
      )}

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
              🤖 AI 生成 · 置信度 {rule.aiConfidence ? `${(rule.aiConfidence * 100).toFixed(0)}%` : "未知"}
            </span>
          )}
        </div>
        {/* AI 推测提示 */}
        {aiFieldMappings.length > 0 && (
          <div className="p-2.5 bg-[#fff7e6] rounded-lg border border-[#ffd591] flex items-start gap-2">
            <span className="text-sm shrink-0">💡</span>
            <p className="text-xs text-[#86909c] leading-relaxed">
              以下字段中，<strong className="text-[#ff7d00]">橙色标注 ⚠️ 推测</strong>表示 AI 置信度较低（&lt;50%），<strong className="text-[#ff7d00]">黄色 💡 参考</strong>表示中等置信度（50%~75%），<strong>绿色 ✅ 确认</strong>表示高置信度（&gt;75%）。
              请重点检查标注为推测的字段是否正确。
            </p>
          </div>
        )}
        <div className="border border-[#e5e6eb] rounded-xl overflow-hidden">
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 bg-[#f7f8fa] border-b border-[#e5e6eb] text-xs font-semibold text-[#4e5969]">
            <div className="col-span-3 lg:col-span-3">目标字段</div>
            <div className="col-span-3 lg:col-span-3">映射模式</div>
            <div className="col-span-3 lg:col-span-3">列名/值</div>
            <div className="col-span-1 lg:col-span-1">必填</div>
            <div className="col-span-2 lg:col-span-2">AI 推断</div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {mappings.map((mapping, index) => {
              // 查找对应的 AI 映射信息
              const aiInfo = aiFieldMappings.find(
                (fm) => fm.targetField === mapping.targetField
              );
              const conf = aiInfo?.confidence || 0;
              const isLow = conf > 0 && conf < 0.5;
              const isMedium = conf >= 0.5 && conf < 0.75;
              const isHigh = conf >= 0.75;

              return (
              <div
                key={index}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 px-3 lg:px-4 py-2.5 sm:py-2 border-b border-[#f2f3f5] text-sm"
              >
                <div className="sm:col-span-3 lg:col-span-3 flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#4e5969] sm:hidden">目标字段：</span>
                  <span className="text-[#1d2129] font-medium">
                    {mapping.targetField}
                  </span>
                  {mapping.required && (
                    <span className="text-[#cf1322] ml-1">*</span>
                  )}
                </div>
                <div className="sm:col-span-3 lg:col-span-3">
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
                    <option value="row_field">行字段匹配</option>
                    <option value="regex_extract">正则提取</option>
                    <option value="ai_infer">AI 推断</option>
                  </select>
                </div>
                <div className="sm:col-span-3 lg:col-span-3">
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
                <div className="sm:col-span-1 lg:col-span-1 flex items-center gap-2">
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
                {/* AI 推断标注列 */}
                <div className="sm:col-span-2 lg:col-span-2 flex items-center gap-1">
                  {aiInfo ? (
                    <span
                      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                        isLow
                          ? "bg-[#fff7e6] text-[#ff7d00] border border-[#ffd591]"
                          : isMedium
                            ? "bg-[#fffbe6] text-[#ff7d00]"
                            : isHigh
                              ? "bg-[#e8ffea] text-[#00b42a]"
                              : "bg-[#f2f3f5] text-[#86909c]"
                      }`}
                      title={aiInfo.note || `置信度: ${(conf * 100).toFixed(0)}%`}
                    >
                      {isLow ? "⚠️ 推测" : isMedium ? "💡 参考" : isHigh ? "✅ 确认" : "—"}
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
