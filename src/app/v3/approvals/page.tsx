"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ExceptionTicket, EXCEPTION_TYPE_LABELS, TICKET_STATUS_LABELS, MOCK_USERS, CurrentUser } from "@/types";

function initV3() {
  return fetch("/api/v3/init").catch(() => {});
}

export default function ApprovalsPage() {
  const [user, setUser] = useState<CurrentUser>(MOCK_USERS[2]); // 默认一级审批人
  const [tickets, setTickets] = useState<ExceptionTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("pending");

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      params.set("page", String(page));
      params.set("pageSize", "20");
      const res = await fetch(`/api/v3/tickets?${params}`);
      const data = await res.json();
      if (data.success) {
        // 只显示当前审批人可处理的
        const filtered = data.data.tickets.filter((t: ExceptionTicket) => {
          const canApprove = user.role === "admin" ||
            (user.role === "level1_approver" && ["pending", "level1_review"].includes(t.status)) ||
            (user.role === "level2_approver" && ["level2_review"].includes(t.status));
          return canApprove && t.reporter !== user.id;
        });
        setTickets(filtered);
        setTotal(data.data.total);
      }
    } catch {
      toast.error("获取审批列表失败");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, user]);

  useEffect(() => {
    initV3().then(() => fetchTickets());
  }, [fetchTickets]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1d2129]">审批中心</h1>
          <p className="text-sm text-[#86909c] mt-1">待审批工单列表</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-[#4e5969]">审批角色：</label>
          <select
            value={user.id}
            onChange={(e) => { setUser(MOCK_USERS.find((u) => u.id === e.target.value) || MOCK_USERS[2]); setPage(1); }}
            className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 focus:outline-none"
          >
            {MOCK_USERS.filter((u) => u.role.includes("approver") || u.role === "admin").map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 筛选 */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] p-4 card-enhanced">
        <div className="flex gap-3 items-center">
          <label className="text-sm text-[#4e5969]">状态筛选：</label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 focus:outline-none"
          >
            <option value="pending">待审批</option>
            <option value="level1_review">一级审批中</option>
            <option value="level2_review">二级审批中</option>
            <option value="">全部</option>
          </select>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] overflow-hidden card-enhanced">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f7f8fa] border-b border-[#e5e6eb]">
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">工单号</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">异常类型</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">描述</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">金额</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">上报人</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">状态</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">创建时间</th>
                <th className="text-left px-4 py-3 font-medium text-[#4e5969]">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-[#86909c]">加载中...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-[#86909c]">暂无待审批工单</td></tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id} className="border-b border-[#f2f3f5] hover:bg-[#f0faf9]">
                    <td className="px-4 py-3">
                      <Link href={`/v3/tickets/${t.id}`} className="text-[#0fc6c2] hover:underline font-medium">
                        {t.ticketNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#4e5969]">{EXCEPTION_TYPE_LABELS[t.exceptionType] || t.exceptionType}</td>
                    <td className="px-4 py-3 text-[#4e5969] max-w-[200px] truncate">{t.description}</td>
                    <td className="px-4 py-3 text-[#4e5969]">¥{t.amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-[#4e5969] text-xs">{t.reporterRole === "qc_supervisor" ? "品控主管" : "操作员"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        t.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                        t.status === "level1_review" ? "bg-blue-100 text-blue-700" :
                        "bg-purple-100 text-purple-700"
                      }`}>
                        {TICKET_STATUS_LABELS[t.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#86909c] text-xs">{new Date(t.createdAt).toLocaleString("zh-CN")}</td>
                    <td className="px-4 py-3">
                      <Link href={`/v3/tickets/${t.id}`} className="text-[#0fc6c2] text-xs bg-[#e8fafa] px-3 py-1 rounded hover:bg-[#0fc6c2] hover:text-white transition-colors">
                        审批
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#f2f3f5]">
            <span className="text-sm text-[#86909c]">共 {total} 条</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-sm border border-[#e5e6eb] rounded px-3 py-1 disabled:opacity-30">上一页</button>
              <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(total / 20)} className="text-sm border border-[#e5e6eb] rounded px-3 py-1 disabled:opacity-30">下一页</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
