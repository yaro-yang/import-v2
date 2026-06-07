"use client";

import { useState } from "react";
import { ParseRule } from "@/types";
import { Button } from "@/components/ui/Button";

interface RuleSelectorProps {
  rules: ParseRule[];
  selectedRuleId: string | null;
  onSelectRule: (ruleId: string) => void;
  onCreateNew: () => void;
  loading?: boolean;
}

export function RuleSelector({
  rules,
  selectedRuleId,
  onSelectRule,
  onCreateNew,
  loading = false,
}: RuleSelectorProps) {
  const [search, setSearch] = useState("");

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-[#0fc6c2]/10 flex items-center justify-center text-[#0fc6c2] text-sm font-bold flex-shrink-0">
            2
          </div>
          <h3 className="text-base font-semibold text-[#1d2129]">步骤二：选择解析规则</h3>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-4 rounded-xl border border-[#e5e6eb]">
            <div className="skeleton h-4 w-48 mb-2" />
            <div className="skeleton h-3 w-64" />
          </div>
        ))}
      </div>
    );
  }

  const filtered = search
    ? rules.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : rules;

  const fileTypeLabel = (t: string) =>
    t === "excel" ? "Excel" : t === "word" ? "Word" : t === "pdf" ? "PDF" : t;

  return (
    <div className="space-y-4">
      {/* 步骤标题 */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[#0fc6c2]/10 flex items-center justify-center text-[#0fc6c2] text-sm font-bold flex-shrink-0">
          2
        </div>
        <h3 className="text-base font-semibold text-[#1d2129]">步骤二：选择解析规则</h3>
      </div>

      {rules.length === 0 ? (
        <div className="py-10 px-6 text-center bg-gradient-to-b from-[#fafbfc] to-white rounded-xl border border-dashed border-[#c9cdd4]">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#e8fafa] to-[#d4f5f3] flex items-center justify-center mx-auto mb-3.5 shadow-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0fc6c2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </div>
          <p className="text-base font-medium text-[#1d2129] mb-1">暂无解析规则</p>
          <p className="text-sm text-[#86909c] mb-4 max-w-sm mx-auto">让 AI 智能识别文件结构并自动生成解析规则</p>
          <Button size="sm" onClick={onCreateNew}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            AI 新建规则
          </Button>
        </div>
      ) : (
        <>
          {/* 搜索 + 新建 */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <svg
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#86909c] pointer-events-none"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="搜索已有解析规则..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 text-sm bg-[#f7f8fa] border border-[#e5e6eb] rounded-xl outline-none transition-all duration-200 focus:bg-white focus:border-[#0fc6c2] focus:ring-2 focus:ring-[#0fc6c2]/10 placeholder:text-[#b5bbc3] text-[#1d2129]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#e5e6eb] flex items-center justify-center text-[#86909c] hover:bg-[#c9cdd4] hover:text-[#4e5969] transition-colors"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <Button size="sm" onClick={onCreateNew}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              AI 新建规则
            </Button>
          </div>

          {/* 规则列表 */}
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-sm text-[#86909c] text-center py-4">未找到匹配的规则</p>
            ) : (
              filtered.map((rule) => (
                <div
                  key={rule.id}
                  onClick={() => onSelectRule(rule.id)}
                  className={`
                    flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-150
                    ${
                      selectedRuleId === rule.id
                        ? "border-[#0fc6c2] bg-[#e8fafa] shadow-sm"
                        : "border-[#e5e6eb] hover:border-[#0fc6c2] hover:bg-[#f8fafb]"
                    }
                  `}
                >
                  {/* 类型图标 */}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    selectedRuleId === rule.id ? "bg-[#0fc6c2]/15 text-[#0fc6c2]" : "bg-[#f2f3f5] text-[#86909c]"
                  }`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" />
                      <line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" />
                    </svg>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[#1d2129] truncate">{rule.name}</p>
                      {rule.aiGenerated && (
                        <span className="shrink-0 inline-block px-1.5 py-0.5 rounded bg-[#e8fafa] text-[#0fc6c2] text-[10px] font-medium">AI</span>
                      )}
                    </div>
                    <p className="text-xs text-[#86909c] mt-0.5">
                      {fileTypeLabel(rule.fileType)} · {rule.fieldMappings?.length || 0} 个字段映射
                      {rule.aiNotes ? ` · ${rule.aiNotes}` : ""}
                    </p>
                  </div>

                  {selectedRuleId === rule.id ? (
                    <span className="shrink-0 text-xs font-semibold text-[#0fc6c2]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs font-medium text-[#0fc6c2] opacity-0 group-hover:opacity-100 transition-opacity">
                      使用
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
