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
      } else {
        // API 返回错误时不弹 toast，静默处理
        console.error("API error:", data.error);
        setRules([]);
      }
    } catch (err) {
      // 网络错误时也不弹 toast，静默降级为空列表
      console.error("Failed to load rules:", err);
      setRules([]);
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setShowDeleteConfirm(id);
  };

  const confirmDelete = async () => {
    if (!showDeleteConfirm) return;
    const id = showDeleteConfirm;

    setDeletingId(id);
    setShowDeleteConfirm(null);
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
    } finally {
      setDeletingId(null);
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
    <div className="space-y-4 lg:space-y-5 page-container">
      {/* 吸顶操作区：标题 + 状态标签 + 操作按钮 */}
      <div className="sticky top-[56px] z-30 bg-[#f7f8fa] -mx-5 lg:-mx-8 px-5 lg:px-8 pt-2 pb-4 space-y-3">
        {/* 页面标题 + 操作按钮 */}
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] overflow-hidden">
          <div className="flex items-center gap-3 p-4 lg:p-5">
            <div className="w-10 h-10 lg:w-11 lg:h-11 rounded-lg bg-gradient-to-br from-[#0fc6c2] to-[#0bada9] flex items-center justify-center text-white flex-shrink-0 shadow-[0_4px_10px_rgba(15,198,194,0.25)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg lg:text-xl font-semibold text-[#1d2129]">解析规则管理</h1>
              <p className="text-sm lg:text-base text-[#86909c] mt-1 hidden sm:block">
                管理用于解析不同格式出库单文件的规则配置
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" onClick={handleCreate}>
                + 新建规则
              </Button>
            </div>
          </div>
        </div>

        {/* 状态标签栏 */}
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] px-4 lg:px-5">
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            <span className="text-base text-[#4e5969] whitespace-nowrap mr-2">规则类型</span>
            {[
              { key: "all", label: "全部", count: 0, badge: false },
              { key: "excel", label: "Excel", count: 0, badge: false },
              { key: "word", label: "Word", count: 0, badge: false },
              { key: "pdf", label: "PDF", count: 0, badge: false },
              { key: "ai", label: "AI生成", count: 0, badge: false },
            ].map((t) => (
              <button
                key={t.key}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-base font-medium whitespace-nowrap rounded-md transition-colors ${
                  t.key === "all"
                    ? "bg-[#e8fafa] text-[#0fc6c2]"
                    : "text-[#4e5969] hover:bg-[#f7f8fa] hover:text-[#0fc6c2]"
                }`}
              >
                {t.label}
                {t.badge && t.count > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-semibold rounded-full bg-[#ff4d4f] text-white">
                    {t.count > 99 ? "99+" : t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] overflow-hidden animate-fade-in">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-[#f7f8fa] border-b border-[#e5e6eb]">
                  {["规则名称", "文件类型", "字段映射", "描述", "来源", "更新时间", "操作"].map((h) => (
                    <th key={h} className="px-4 lg:px-5 py-3.5 text-left text-base font-semibold text-[#4e5969]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#f2f3f5]">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-3 lg:px-4 py-3">
                        <div className="skeleton h-4 rounded" style={{ width: `${50 + Math.random() * 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-8 lg:p-10">
          <EmptyState
            title="暂无解析规则"
            description="创建解析规则后，可以用于解析各种格式的出库单文件"
            action={<Button size="sm" onClick={handleCreate}>+ 新建规则</Button>}
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-[#f7f8fa] border-b border-[#e5e6eb]">
                  <th className="px-4 lg:px-5 py-3.5 text-left text-base font-semibold text-[#4e5969]">规则名称</th>
                  <th className="px-4 lg:px-5 py-3.5 text-left text-base font-semibold text-[#4e5969]">文件类型</th>
                  <th className="px-4 lg:px-5 py-3.5 text-center text-base font-semibold text-[#4e5969] hidden sm:table-cell">字段映射</th>
                  <th className="px-4 lg:px-5 py-3.5 text-left text-base font-semibold text-[#4e5969] hidden md:table-cell">描述</th>
                  <th className="px-4 lg:px-5 py-3.5 text-left text-base font-semibold text-[#4e5969] hidden sm:table-cell">来源</th>
                  <th className="px-4 lg:px-5 py-3.5 text-left text-base font-semibold text-[#4e5969] hidden md:table-cell">更新时间</th>
                  <th className="px-4 lg:px-5 py-3.5 text-right text-base font-semibold text-[#4e5969] sticky-action-col">操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, index) => (
                  <tr
                    key={rule.id}
                    className={`border-b border-[#f2f3f5] hover:bg-[#fafbfc] transition-colors ${
                      index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"
                    }`}
                  >
                    <td className="px-4 lg:px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#1d2129] whitespace-nowrap">{rule.name}</span>
                        {rule.aiGenerated && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e8fafa] text-[#0fc6c2] font-medium whitespace-nowrap">AI</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 lg:px-5 py-3 text-[#4e5969] uppercase text-sm whitespace-nowrap">{rule.fileType}</td>
                    <td className="px-4 lg:px-5 py-3 text-center text-[#4e5969] text-sm hidden sm:table-cell">
                      {rule.fieldMappings?.length || 0}
                    </td>
                    <td className="px-4 lg:px-5 py-3 text-[#86909c] text-sm max-w-[150px] lg:max-w-[200px] truncate hidden md:table-cell">
                      {rule.description || "—"}
                    </td>
                    <td className="px-4 lg:px-5 py-3 text-[#86909c] text-sm hidden sm:table-cell">
                      {rule.aiGenerated ? "AI生成" : "手动创建"}
                    </td>
                    <td className="px-4 lg:px-5 py-3 text-[#86909c] text-sm whitespace-nowrap hidden md:table-cell">
                      {formatDate(rule.updatedAt)}
                    </td>
                    <td className="px-4 lg:px-5 py-3 text-right sticky-action-col">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEdit(rule)}
                          className="px-2 py-1 text-sm text-[#0fc6c2] hover:text-[#0bada9] hover:bg-[#e8fafa] rounded transition-colors whitespace-nowrap"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleCopy(rule)}
                          className="px-2 py-1 text-sm text-[#0fc6c2] hover:text-[#0bada9] hover:bg-[#e8fafa] rounded transition-colors whitespace-nowrap hidden sm:inline"
                        >
                          复制
                        </button>
                        <button
                          onClick={() => handleDelete(rule.id)}
                          disabled={deletingId === rule.id}
                          className={`px-2 py-1 text-sm text-[#cf1322] hover:bg-[#fff1f0] rounded transition-colors whitespace-nowrap ${
                            deletingId === rule.id ? "opacity-50 cursor-not-allowed" : ""
                          }`}
                        >
                          {deletingId === rule.id ? "删除中..." : "删除"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 底部统计 */}
          <div className="px-5 py-3 border-t border-[#e5e6eb] bg-[#fafbfc] flex items-center justify-between text-sm text-[#86909c]">
            <span>共 {rules.length} 条规则</span>
          </div>
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

      {/* 自定义删除确认弹窗 */}
      {showDeleteConfirm && (
        <div className="confirm-dialog-overlay" onClick={() => setShowDeleteConfirm(null)}>
          <div className="confirm-dialog-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#fff1f0] flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cf1322" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#1d2129] mb-1">确认删除</h3>
                <p className="text-sm text-[#86909c] leading-relaxed">确定要删除此规则吗？删除后不可恢复。</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-sm rounded-lg border border-[#e5e6eb] text-[#4e5969] hover:bg-[#f7f8fa] transition-colors font-medium"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm rounded-lg bg-[#cf1322] text-white hover:bg-[#b0101c] transition-colors font-medium shadow-sm"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
