"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { ParseRule } from "@/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { RuleEditor } from "@/components/preview/RuleEditor";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/utils";

export default function RulesPage() {
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<ParseRule> | null>(null);

  // 加载规则
  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rules");
      const data = await res.json();
      if (data.success) {
        setRules(data.data);
      }
    } catch (err) {
      console.error("Failed to load rules:", err);
      toast.error("加载规则失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // 新建规则
  const handleCreate = () => {
    setEditingRule(null);
    setShowEditor(true);
  };

  // 编辑规则
  const handleEdit = (rule: ParseRule) => {
    setEditingRule(rule);
    setShowEditor(true);
  };

  // 复制规则
  const handleCopy = (rule: ParseRule) => {
    setEditingRule({
      ...rule,
      id: "",
      name: `${rule.name} (副本)`,
      aiGenerated: false,
    });
    setShowEditor(true);
  };

  // 删除规则
  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除此规则吗？")) return;

    try {
      const res = await fetch(`/api/rules?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success("规则已删除");
        loadRules();
      } else {
        toast.error(data.error || "删除失败");
      }
    } catch (err) {
      console.error("Delete rule error:", err);
      toast.error("删除失败");
    }
  };

  // 保存规则
  const handleSave = async (rule: ParseRule) => {
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      const data = await res.json();

      if (data.success) {
        toast.success("规则保存成功");
        setShowEditor(false);
        loadRules();
      } else {
        toast.error(data.error || "保存失败");
      }
    } catch (err) {
      console.error("Save rule error:", err);
      toast.error("保存规则失败");
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d2129]">解析规则管理</h1>
          <p className="text-sm text-[#86909c] mt-1">
            管理文件解析规则，支持手动配置和 AI 辅助生成
          </p>
        </div>
        <Button onClick={handleCreate}>
          + 新建规则
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-[#e5e6eb] border-t-[#0fc6c2] rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[#86909c] mt-3">加载中...</p>
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
          <EmptyState
            icon="⚙️"
            title="暂无解析规则"
            description="创建解析规则后，可以用于解析各种格式的出库单文件"
            action={<Button onClick={handleCreate}>+ 新建规则</Button>}
          />
        </div>
      ) : (
        <div className="grid gap-4">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-5 hover:border-[#0fc6c2] transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-semibold text-[#1d2129] truncate">
                      {rule.name}
                    </h3>
                    {rule.aiGenerated && (
                      <span className="flex-shrink-0 text-xs bg-[#e8fafa] text-[#0b6e6e] px-2 py-0.5 rounded-full">
                        🤖 AI 生成
                      </span>
                    )}
                    <span className="flex-shrink-0 text-xs bg-[#f7f8fa] text-[#4e5969] px-2 py-0.5 rounded-full">
                      {rule.fileType.toUpperCase()}
                    </span>
                  </div>
                  {rule.description && (
                    <p className="text-sm text-[#4e5969] mb-2">
                      {rule.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-[#86909c]">
                    <span>
                      {rule.fieldMappings?.length || 0} 个字段映射
                    </span>
                    <span>
                      跳过头部: {rule.dataRegion?.skipRows || 0} 行
                    </span>
                    {rule.globalConfig?.groupByExternalCode && (
                      <span>按外部编码聚合</span>
                    )}
                    <span>更新于 {formatDate(rule.updatedAt)}</span>
                  </div>
                  {rule.aiConfidence !== undefined && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#86909c]">AI 置信度</span>
                        <div className="flex-1 max-w-[120px] h-1.5 bg-[#f2f3f5] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#0fc6c2] rounded-full"
                            style={{
                              width: `${(rule.aiConfidence * 100).toFixed(0)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-[#0fc6c2] font-medium">
                          {(rule.aiConfidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(rule)}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(rule)}
                  >
                    复制
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(rule.id)}
                  >
                    <span className="text-[#cf1322]">删除</span>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 规则编辑器弹窗 */}
      <Modal
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
        title={editingRule ? "编辑解析规则" : "新建解析规则"}
        size="xl"
      >
        <RuleEditor
          rule={editingRule}
          onSave={handleSave}
          onCancel={() => setShowEditor(false)}
        />
      </Modal>
    </div>
  );
}
