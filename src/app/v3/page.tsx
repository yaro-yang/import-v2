"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

function initV3() { return fetch("/api/v3/init").catch(() => {}); }

export default function V3Dashboard() {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initV3().then(async () => {
      try {
        const res = await fetch("/api/v3/tickets?pageSize=9999");
        const data = await res.json();
        if (data.success) {
          const s: Record<string, number> = { total: data.data.total };
          (data.data.tickets as Record<string, unknown>[]).forEach((t: Record<string, unknown>) => {
            const status = t.status as string;
            s[status] = (s[status] || 0) + 1;
          });
          setStats(s);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    });
  }, []);

  const quickLinks = [
    { href: "/v3/scan", label: "扫描品控", desc: "扫描录入 SKU，自动品控检测", icon: "🔍", color: "#ba7517" },
    { href: "/v3/tickets/new", label: "异常上报", desc: "手工上报物流异常工单", icon: "📝", color: "#185fa5" },
    { href: "/v3/tickets", label: "工单管理", desc: "查看和处理所有异常工单", icon: "📋", color: "#0fc6c2" },
    { href: "/v3/approvals", label: "审批中心", desc: "审批待处理的工单", icon: "✅", color: "#00a854" },
    { href: "/v3/settings", label: "规则配置", desc: "配置品控规则和审批阈值", icon: "⚙️", color: "#4e5969" },
    { href: "/v3/monitor", label: "同步监控", desc: "V2 接口调用状态监控", icon: "📊", color: "#d97b00" },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#1d2129]">运单全流程管理</h1>
        <p className="text-sm text-[#86909c] mt-1">覆盖扫描品控 → 异常上报 → 分级审批 → 执行联动的全生命周期</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "全部工单", value: stats.total || 0, color: "#1d2129", icon: "📊" },
          { label: "待审批", value: (stats.pending || 0), color: "#d97b00", icon: "📋" },
          { label: "审批中", value: (stats.level1_review || 0) + (stats.level2_review || 0), color: "#185fa5", icon: "🔍" },
          { label: "执行中", value: stats.executing || 0, color: "#0fc6c2", icon: "⚙️" },
          { label: "已完成", value: stats.completed || 0, color: "#00a854", icon: "✅" },
          { label: "已驳回", value: stats.rejected_final || 0, color: "#cf1322", icon: "❌" },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-xl border border-[#e5e6eb] p-4 card-enhanced hover:shadow-md transition-shadow">
            <div className="text-lg mb-1">{s.icon}</div>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{loading ? "-" : s.value}</p>
            <p className="text-xs text-[#86909c] mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {quickLinks.map((link) => (
          <Link key={link.href} href={link.href} className="bg-white rounded-xl border border-[#e5e6eb] p-5 card-enhanced hover:shadow-md hover:border-[#0fc6c2] transition-all group">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl" style={{ backgroundColor: `${link.color}10` }}>{link.icon}</div>
              <div>
                <h3 className="text-sm font-semibold text-[#1d2129] group-hover:text-[#0fc6c2] transition-colors">{link.label}</h3>
                <p className="text-xs text-[#86909c] mt-1">{link.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Process Flow */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
        <h2 className="text-base font-semibold text-[#1d2129] mb-4">运单全流程</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {[
            { label: "V2录单", color: "#86909c" },
            { label: "→", color: "#e5e6eb" },
            { label: "扫描品控", color: "#ba7517" },
            { label: "→", color: "#e5e6eb" },
            { label: "异常上报", color: "#185fa5" },
            { label: "→", color: "#e5e6eb" },
            { label: "分级审批", color: "#0fc6c2" },
            { label: "→", color: "#e5e6eb" },
            { label: "执行联动", color: "#00a854" },
            { label: "→", color: "#e5e6eb" },
            { label: "完成", color: "#4e5969" },
          ].map((step, i) => (
            <span key={i} className={`px-2 py-1 rounded font-medium ${step.color === "#e5e6eb" ? "text-[#c9cdd4]" : "bg-white border"}`} style={step.color !== "#e5e6eb" ? { borderColor: step.color, color: step.color } : {}}>
              {step.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
