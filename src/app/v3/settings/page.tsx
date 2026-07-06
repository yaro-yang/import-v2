"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { QCRule, EXCEPTION_TYPE_LABELS } from "@/types";

function initV3() {
  return fetch("/api/v3/init").catch(() => {});
}

export default function SettingsPage() {
  const [tab, setTab] = useState<"qc" | "approval">("qc");
  const [qcRules, setQcRules] = useState<QCRule[]>([]);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 新规则表单
  const [newRule, setNewRule] = useState({
    name: "",
    exceptionSubType: "qc_quantity" as string,
    conditionField: "quantity_diff_percent",
    conditionOperator: "gt" as string,
    conditionValue: "",
    severity: "medium" as string,
    autoCreateTicket: true,
    approvalLevel: 1,
    priority: 0,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, configRes] = await Promise.all([
        fetch("/api/v3/qc-rules"),
        fetch("/api/v3/config"),
      ]);
      const rulesData = await rulesRes.json();
      const configData = await configRes.json();
      if (rulesData.success) setQcRules(rulesData.data);
      if (configData.success) setConfig(configData.data);
    } catch {
      toast.error("获取配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initV3().then(() => fetchData());
  }, [fetchData]);

  const saveQCRule = async (rule: Partial<QCRule>) => {
    try {
      const res = await fetch("/api/v3/qc-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("规则已保存");
        fetchData();
      }
    } catch {
      toast.error("保存失败");
    }
  };

  const deleteQCRule = async (id: string) => {
    if (!confirm("确认删除此规则？")) return;
    try {
      await fetch(`/api/v3/qc-rules?id=${id}`, { method: "DELETE" });
      toast.success("已删除");
      fetchData();
    } catch {
      toast.error("删除失败");
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await fetch("/api/v3/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      toast.success("配置已更新");
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleQCRule = async (rule: QCRule) => {
    await saveQCRule({ ...rule, enabled: !rule.enabled });
  };

  if (loading) {
    return (
      <div className="animate-fade-in flex items-center justify-center h-64">
        <p className="text-[#86909c]">加载中...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#1d2129]">规则配置</h1>
        <p className="text-sm text-[#86909c] mt-1">品控规则引擎 + 审批阈值配置（可配置，非硬编码）</p>
      </div>

      {/* Tab切换 */}
      <div className="flex gap-1 bg-[#f2f3f5] rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("qc")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "qc" ? "bg-white text-[#0fc6c2] shadow-sm" : "text-[#4e5969] hover:text-[#1d2129]"}`}
        >
          品控规则
        </button>
        <button
          onClick={() => setTab("approval")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "approval" ? "bg-white text-[#0fc6c2] shadow-sm" : "text-[#4e5969] hover:text-[#1d2129]"}`}
        >
          审批阈值
        </button>
      </div>

      {/* 品控规则 */}
      {tab === "qc" && (
        <div className="space-y-6">
          {/* 添加规则 */}
          <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
            <h2 className="text-base font-semibold text-[#1d2129] mb-4">新增规则</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="text"
                value={newRule.name}
                onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                placeholder="规则名称"
                className="border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
              <select
                value={newRule.exceptionSubType}
                onChange={(e) => setNewRule({ ...newRule, exceptionSubType: e.target.value })}
                className="border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                {Object.entries(EXCEPTION_TYPE_LABELS).filter(([k]) => k.startsWith("qc_")).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select
                value={newRule.conditionOperator}
                onChange={(e) => setNewRule({ ...newRule, conditionOperator: e.target.value })}
                className="border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                <option value="gt">大于</option>
                <option value="lt">小于</option>
                <option value="gte">大于等于</option>
                <option value="lte">小于等于</option>
                <option value="eq">等于</option>
                <option value="neq">不等于</option>
              </select>
              <input
                type="text"
                value={newRule.conditionValue}
                onChange={(e) => setNewRule({ ...newRule, conditionValue: e.target.value })}
                placeholder="阈值"
                className="border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
              <select
                value={newRule.severity}
                onChange={(e) => setNewRule({ ...newRule, severity: e.target.value })}
                className="border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                <option value="low">低严重度</option>
                <option value="medium">中严重度</option>
                <option value="high">高严重度</option>
                <option value="critical">严重</option>
              </select>
              <select
                value={newRule.approvalLevel}
                onChange={(e) => setNewRule({ ...newRule, approvalLevel: Number(e.target.value) })}
                className="border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                <option value={1}>一级审批</option>
                <option value={2}>二级审批</option>
              </select>
              <input
                type="number"
                value={newRule.priority}
                onChange={(e) => setNewRule({ ...newRule, priority: Number(e.target.value) })}
                placeholder="优先级"
                className="border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <button
              onClick={() => {
                if (!newRule.name || !newRule.conditionValue) {
                  toast.error("请填写规则名称和阈值");
                  return;
                }
                saveQCRule(newRule as unknown as Partial<QCRule>);
              }}
              className="mt-3 bg-[#0fc6c2] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#0bada9] transition-colors"
            >
              添加规则
            </button>
          </div>

          {/* 规则列表 */}
          <div className="bg-white rounded-xl border border-[#e5e6eb] overflow-hidden card-enhanced">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f7f8fa] border-b border-[#e5e6eb]">
                  <th className="text-left px-4 py-3 font-medium text-[#4e5969]">规则名</th>
                  <th className="text-left px-4 py-3 font-medium text-[#4e5969]">异常类型</th>
                  <th className="text-left px-4 py-3 font-medium text-[#4e5969]">条件</th>
                  <th className="text-left px-4 py-3 font-medium text-[#4e5969]">严重度</th>
                  <th className="text-left px-4 py-3 font-medium text-[#4e5969]">审批层级</th>
                  <th className="text-left px-4 py-3 font-medium text-[#4e5969]">启用</th>
                  <th className="text-left px-4 py-3 font-medium text-[#4e5969]">操作</th>
                </tr>
              </thead>
              <tbody>
                {qcRules.map((rule) => (
                  <tr key={rule.id} className="border-b border-[#f2f3f5]">
                    <td className="px-4 py-3 font-medium text-[#1d2129]">{rule.name}</td>
                    <td className="px-4 py-3 text-[#4e5969]">{EXCEPTION_TYPE_LABELS[rule.exceptionSubType]}</td>
                    <td className="px-4 py-3 text-[#4e5969]">
                      {rule.conditionField} {rule.conditionOperator} {rule.conditionValue}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        rule.severity === "critical" ? "bg-red-100 text-red-600" :
                        rule.severity === "high" ? "bg-orange-100 text-orange-600" :
                        rule.severity === "medium" ? "bg-yellow-100 text-yellow-600" :
                        "bg-blue-100 text-blue-600"
                      }`}>{rule.severity}</span>
                    </td>
                    <td className="px-4 py-3 text-[#4e5969]">第{rule.approvalLevel}级</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleQCRule(rule)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${rule.enabled ? "bg-[#0fc6c2]" : "bg-gray-300"}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${rule.enabled ? "left-5" : "left-0.5"}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteQCRule(rule.id)}
                        className="text-red-400 text-xs hover:text-red-600"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 审批阈值 */}
      {tab === "approval" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced space-y-4">
            <h2 className="text-base font-semibold text-[#1d2129]">审批阈值配置</h2>
            <p className="text-xs text-[#86909c]">所有阈值可在后台实时调整，无需修改代码</p>

            {[
              { key: "level2_threshold", label: "二级审批金额阈值（元）", desc: "工单金额超过此值时自动进入二级审批" },
              { key: "level1_timeout_hours", label: "一级审批超时（小时）", desc: "超过此时长自动升级到二级审批" },
              { key: "level2_timeout_hours", label: "二级审批超时（小时）", desc: "超过此时长自动驳回" },
              { key: "pending_timeout_hours", label: "待审批超时（小时）", desc: "待审批状态超过此时长自动升级到二级审批" },
              { key: "max_reject_count", label: "最大重提次数", desc: "被拒绝后最多可重新提交的次数" },
              { key: "qc_hold_timeout_hours", label: "品控暂扣超时（小时）", desc: "品控异常暂扣超时后强制升级二级审批（独立于审批超时）" },
            ].map((item) => (
              <div key={item.key} className="flex items-center gap-4 p-3 bg-[#f7f8fa] rounded-lg">
                <div className="flex-1">
                  <label className="text-sm font-medium text-[#1d2129]">{item.label}</label>
                  <p className="text-xs text-[#86909c] mt-1">{item.desc}</p>
                </div>
                <input
                  type="number"
                  value={config[item.key] || ""}
                  onChange={(e) => setConfig({ ...config, [item.key]: e.target.value })}
                  className="w-32 border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none text-right"
                />
              </div>
            ))}

            <button
              onClick={saveConfig}
              disabled={saving}
              className="w-full bg-[#0fc6c2] text-white rounded-lg py-2.5 font-medium text-sm hover:bg-[#0bada9] transition-colors disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存配置"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
