"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ExceptionTicket, EXCEPTION_TYPE_LABELS, TICKET_STATUS_LABELS, TicketStatus, MOCK_USERS, CurrentUser } from "@/types";

function initV3() {
  return fetch("/api/v3/init").catch(() => {});
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  level1_review: "bg-blue-100 text-blue-700",
  level2_review: "bg-purple-100 text-purple-700",
  executing: "bg-teal-100 text-teal-700",
  completed: "bg-green-100 text-green-700",
  rejected_final: "bg-red-100 text-red-700",
};

export default function TicketsPage() {
  const [tickets, setTickets] = useState<ExceptionTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [codeFilter, setCodeFilter] = useState("");
  const [user, setUser] = useState<CurrentUser>(MOCK_USERS[0]);
  const [generating, setGenerating] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("exceptionType", typeFilter);
      if (codeFilter) params.set("waybillCode", codeFilter);
      params.set("page", String(page));
      params.set("pageSize", "20");

      const res = await fetch(`/api/v3/tickets?${params}`);
      const data = await res.json();
      if (data.success) {
        setTickets(data.data.tickets);
        setTotal(data.data.total);
      }
    } catch {
      toast.error("获取工单失败");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter, codeFilter]);

  useEffect(() => {
    initV3().then(() => fetchTickets());
  }, [fetchTickets]);

  const generateMock = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/v3/mock-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 200 }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`成功生成 ${data.data.generated} 条模拟工单`);
        fetchTickets();
      }
    } catch {
      toast.error("生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const isQCType = (type: string) => type.startsWith("qc_");
  const isNearTimeout = (ticket: ExceptionTicket) => {
    if (!ticket.timeoutAt) return false;
    const timeout = new Date(ticket.timeoutAt).getTime();
    const now = Date.now();
    return timeout - now < 3600000 && timeout > now; // 1小时内超时
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1d2129]">工单管理</h1>
          <p className="text-sm text-[#86909c] mt-1">共 {total} 条工单</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={user.id}
            onChange={(e) => setUser(MOCK_USERS.find((u) => u.id === e.target.value) || MOCK_USERS[0])}
            className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 focus:outline-none"
          >
            {MOCK_USERS.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button
            onClick={generateMock}
            disabled={generating}
            className="text-sm border border-[#0fc6c2] text-[#0fc6c2] rounded-lg px-4 py-1.5 hover:bg-[#e8fafa] transition-colors disabled:opacity-50"
          >
            {generating ? "生成中..." : "生成模拟数据"}
          </button>
          <Link
            href="/v3/tickets/new"
            className="text-sm bg-[#0fc6c2] text-white rounded-lg px-4 py-1.5 hover:bg-[#0bada9] transition-colors"
          >
            + 新建工单
          </Link>
        </div>
      </div>

      {/* 筛选 */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] p-4 card-enhanced">
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 focus:outline-none"
          >
            <option value="">全部状态</option>
            {Object.entries(TICKET_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 focus:outline-none"
          >
            <option value="">全部类型</option>
            <optgroup label="物流异常">
              {["lost","damaged","rejected","timeout","address_error"].map((t) => (
                <option key={t} value={t}>{EXCEPTION_TYPE_LABELS[t as keyof typeof EXCEPTION_TYPE_LABELS]}</option>
              ))}
            </optgroup>
            <optgroup label="品控异常">
              {["qc_quantity","qc_appearance","qc_spec","qc_label","qc_batch"].map((t) => (
                <option key={t} value={t}>{EXCEPTION_TYPE_LABELS[t as keyof typeof EXCEPTION_TYPE_LABELS]}</option>
              ))}
            </optgroup>
          </select>
          <input
            type="text"
            value={codeFilter}
            onChange={(e) => { setCodeFilter(e.target.value); setPage(1); }}
            placeholder="运单号搜索..."
            className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 w-48 focus:outline-none"
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] overflow-hidden card-enhanced">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f8fa] border-b border-[#e5e6eb]">
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">工单号</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">运单号</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">异常类型</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">来源</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">金额</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">状态</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">上报人</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">创建时间</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-[#86909c]">加载中...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-[#86909c]">暂无工单数据，请先生成模拟数据</td></tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id} className={`border-b border-[#f2f3f5] hover:bg-[#f0faf9] transition-colors ${isNearTimeout(t) ? "bg-[#fff7e8]" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={`/v3/tickets/${t.id}`} className="text-[#0fc6c2] hover:underline font-medium">
                        {t.ticketNo}
                      </Link>
                      {isNearTimeout(t) && <span className="ml-1 text-[10px] bg-red-100 text-red-600 px-1 rounded">即将超时</span>}
                    </td>
                    <td className="px-4 py-3 text-[#4e5969]">{t.waybillSnapshot?.externalCode || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs ${isQCType(t.exceptionType) ? "text-[#ba7517]" : "text-[#185fa5]"}`}>
                        {isQCType(t.exceptionType) ? "🔍" : "📦"} {EXCEPTION_TYPE_LABELS[t.exceptionType] || t.exceptionType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${t.exceptionSource === "scan_trigger" ? "bg-[#faf0dc] text-[#ba7517]" : "bg-[#e6f1fb] text-[#185fa5]"}`}>
                        {t.exceptionSource === "scan_trigger" ? "扫描触发" : "手工上报"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#4e5969]">¥{t.amount.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[t.status] || ""}`}>
                        {TICKET_STATUS_LABELS[t.status] || t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#4e5969] text-xs">{t.reporterRole === "qc_supervisor" ? "品控主管" : "操作员"}</td>
                    <td className="px-4 py-3 text-[#86909c] text-xs">{new Date(t.createdAt).toLocaleString("zh-CN")}</td>
                    <td className="px-4 py-3">
                      <Link href={`/v3/tickets/${t.id}`} className="text-[#0fc6c2] text-xs hover:underline">详情</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* 分页 */}
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#f2f3f5]">
            <span className="text-sm text-[#86909c]">共 {total} 条，第 {page}/{Math.ceil(total / 20)} 页</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="text-sm border border-[#e5e6eb] rounded px-3 py-1 disabled:opacity-30 hover:bg-[#f7f8fa]"
              >
                上一页
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(total / 20)}
                className="text-sm border border-[#e5e6eb] rounded px-3 py-1 disabled:opacity-30 hover:bg-[#f7f8fa]"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
