"use client";

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
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1d2129]">选择解析规则</h3>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 rounded-lg border border-[#e5e6eb]">
              <div className="skeleton h-4 w-32 mb-2" />
              <div className="skeleton h-3 w-48" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#1d2129]">选择解析规则</h3>
        <Button size="sm" variant="ghost" onClick={onCreateNew}>
          + 新建规则
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="p-8 text-center bg-[#fafbfc] rounded-xl border border-dashed border-[#e5e6eb]">
          <div className="w-12 h-12 rounded-full bg-[#f2f3f5] flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#86909c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </div>
          <p className="text-sm text-[#86909c] mb-3">暂无解析规则</p>
          <Button size="sm" onClick={onCreateNew}>
            新建解析规则
          </Button>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {rules.map((rule) => (
            <label
              key={rule.id}
                className={`
                flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-150
                ${
                  selectedRuleId === rule.id
                    ? "border-[#0fc6c2] bg-[#e8fafa] shadow-sm"
                    : "border-[#e5e6eb] hover:border-[#0fc6c2] hover:bg-[#f8fafb]"
                }
              `}
            >
              <input
                type="radio"
                name="rule"
                value={rule.id}
                checked={selectedRuleId === rule.id}
                onChange={() => onSelectRule(rule.id)}
                className="accent-[#0fc6c2]"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1d2129] truncate">
                  {rule.name}
                </p>
                <p className="text-xs text-[#86909c] mt-0.5">
                  {rule.fileType.toUpperCase()} ·{" "}
                  {rule.fieldMappings?.length || 0} 个字段映射
                  {rule.aiGenerated && (
                    <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-[#e8fafa] text-[#0fc6c2] text-[10px] font-medium">
                      AI
                    </span>
                  )}
                </p>
              </div>
              {selectedRuleId === rule.id && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0fc6c2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
