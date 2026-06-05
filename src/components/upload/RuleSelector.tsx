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
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#1d2129]">选择解析规则</h3>
        <Button size="sm" variant="ghost" onClick={onCreateNew}>
          + 新建规则
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="p-6 text-center bg-[#fafbfc] rounded-lg border border-[#e5e6eb]">
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
                flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-200
                ${
                  selectedRuleId === rule.id
                    ? "border-[#0fc6c2] bg-[#e8fafa]"
                    : "border-[#e5e6eb] hover:border-[#0fc6c2] hover:bg-[#f7f8fa]"
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
                <p className="text-xs text-[#86909c]">
                  {rule.fileType.toUpperCase()} ·{" "}
                  {rule.fieldMappings?.length || 0} 个字段映射
                  {rule.aiGenerated && " · 🤖 AI生成"}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}

      {loading && (
        <div className="text-center py-2">
          <span className="text-sm text-[#86909c]">加载规则中...</span>
        </div>
      )}
    </div>
  );
}
