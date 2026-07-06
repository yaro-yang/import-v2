"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import { ExceptionTicket, EXCEPTION_TYPE_LABELS, TICKET_STATUS_LABELS, MOCK_USERS, CurrentUser } from "@/types";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  level1_review: "bg-blue-100 text-blue-700",
  level2_review: "bg-purple-100 text-purple-700",
  executing: "bg-teal-100 text-teal-700",
  completed: "bg-green-100 text-green-700",
  rejected_final: "bg-red-100 text-red-700",
};

export default function TicketDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [ticket, setTicket] = useState<ExceptionTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [user, setUser] = useState<CurrentUser>(MOCK_USERS[2]); // 默认一级审批人
  const [opinion, setOpinion] = useState("");
  const [showFastRelease, setShowFastRelease] = useState(false);
  const [fastReleaseReason, setFastReleaseReason] = useState("");

  const fetchTicket = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v3/tickets/${id}`);
      const data = await res.json();
      if (data.success) {
        setTicket(data.data);
      } else {
        toast.error(data.error || "获取工单失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetch("/api/v3/init").then(() => fetchTicket());
  }, [fetchTicket]);

  const handleApproval = async (action: "approve" | "reject") => {
    if (!user.role.includes("approver") && user.role !== "admin") {
      toast.error("您没有审批权限");
      return;
    }
    if (ticket?.reporter === user.id) {
      toast.error("不能审批自己上报的工单");
      return;
    }

    setApproving(true);
    try {
      const res = await fetch("/api/v3/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: id,
          approver: user.id,
          approverRole: user.role,
          action,
          opinion,
          triggeredBy: "manual",
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || (action === "approve" ? "审批通过" : "已拒绝"));
        setOpinion("");
        fetchTicket();
      } else {
        toast.error(data.error || "操作失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setApproving(false);
    }
  };

  const handleFastRelease = async () => {
    if (!fastReleaseReason.trim()) {
      toast.error("请填写复核原因");
      return;
    }
    if (user.role !== "qc_supervisor" && user.role !== "admin") {
      toast.error("仅品控主管可执行快速放行");
      return;
    }

    setApproving(true);
    try {
      const res = await fetch("/api/v3/fast-release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: id,
          operator: user.id,
          operatorRole: user.role,
          reason: fastReleaseReason,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("快速放行成功");
        setShowFastRelease(false);
        setFastReleaseReason("");
        fetchTicket();
      } else {
        toast.error(data.error || "操作失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setApproving(false);
    }
  };

  const canApprove = ticket && ["pending", "level1_review", "level2_review"].includes(ticket.status);
  const isSelfReport = ticket?.reporter === user.id;
  const canFastRelease = ticket?.exceptionSource === "scan_trigger" && canApprove;

  if (loading) {
    return (
      <div className="animate-fade-in flex items-center justify-center h-64">
        <p className="text-[#86909c]">加载中...</p>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="animate-fade-in flex items-center justify-center h-64">
        <p className="text-[#86909c]">工单不存在</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1d2129]">工单详情 - {ticket.ticketNo}</h1>
          <p className="text-sm text-[#86909c] mt-1">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[ticket.status]}`}>
              {TICKET_STATUS_LABELS[ticket.status]}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-[#4e5969]">当前角色：</label>
          <select
            value={user.id}
            onChange={(e) => setUser(MOCK_USERS.find((u) => u.id === e.target.value) || MOCK_USERS[0])}
            className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 focus:outline-none"
          >
            {MOCK_USERS.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 工单信息 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 基本信息 */}
          <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
            <h2 className="text-base font-semibold text-[#1d2129] mb-4">基本信息</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[#86909c]">工单号：</span>
                <span className="text-[#1d2129] ml-2 font-medium">{ticket.ticketNo}</span>
              </div>
              <div>
                <span className="text-[#86909c]">异常类型：</span>
                <span className="text-[#1d2129] ml-2">{EXCEPTION_TYPE_LABELS[ticket.exceptionType]}</span>
              </div>
              <div>
                <span className="text-[#86909c]">来源：</span>
                <span className={`ml-2 px-2 py-0.5 rounded text-xs ${ticket.exceptionSource === "scan_trigger" ? "bg-[#faf0dc] text-[#ba7517]" : "bg-[#e6f1fb] text-[#185fa5]"}`}>
                  {ticket.exceptionSource === "scan_trigger" ? "扫描自动触发" : "手工上报"}
                </span>
              </div>
              <div>
                <span className="text-[#86909c]">金额：</span>
                <span className="text-[#1d2129] ml-2">¥{ticket.amount.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[#86909c]">上报人：</span>
                <span className="text-[#1d2129] ml-2">{ticket.reporterRole === "qc_supervisor" ? "品控主管" : "操作员"}</span>
              </div>
              <div>
                <span className="text-[#86909c]">当前层级：</span>
                <span className="text-[#1d2129] ml-2">第 {ticket.currentLevel} 级</span>
              </div>
              <div>
                <span className="text-[#86909c]">重提次数：</span>
                <span className="text-[#1d2129] ml-2">{ticket.rejectCount}/{ticket.maxRejectCount}</span>
              </div>
              <div>
                <span className="text-[#86909c]">创建时间：</span>
                <span className="text-[#1d2129] ml-2">{new Date(ticket.createdAt).toLocaleString("zh-CN")}</span>
              </div>
              {ticket.timeoutAt && (
                <div className="col-span-2">
                  <span className="text-[#86909c]">超时时间：</span>
                  <span className={`ml-2 ${new Date(ticket.timeoutAt).getTime() < Date.now() ? "text-red-500" : "text-[#d97b00]"}`}>
                    {new Date(ticket.timeoutAt).toLocaleString("zh-CN")}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-4 p-3 bg-[#f7f8fa] rounded-lg">
              <p className="text-sm text-[#86909c]">异常描述：</p>
              <p className="text-sm text-[#1d2129] mt-1">{ticket.description}</p>
            </div>
          </div>

          {/* 关联运单信息 */}
          {ticket.waybillSnapshot && (
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
              <h2 className="text-base font-semibold text-[#1d2129] mb-4">
                关联运单
                <span className="text-xs text-[#86909c] ml-2 bg-[#f7f8fa] px-2 py-0.5 rounded">
                  数据来源：本地缓存，同步于 {new Date(ticket.waybillSnapshot.syncedAt).toLocaleString("zh-CN")}
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[#86909c]">运单ID：</span>
                  <span className="text-[#1d2129] ml-2">{ticket.waybillSnapshot.waybillId}</span>
                </div>
                <div>
                  <span className="text-[#86909c]">运单号：</span>
                  <span className="text-[#1d2129] ml-2">{ticket.waybillSnapshot.externalCode || "-"}</span>
                </div>
                <div>
                  <span className="text-[#86909c]">门店：</span>
                  <span className="text-[#1d2129] ml-2">{ticket.waybillSnapshot.storeName || "-"}</span>
                </div>
                <div>
                  <span className="text-[#86909c]">收件人：</span>
                  <span className="text-[#1d2129] ml-2">{ticket.waybillSnapshot.recipientName || "-"}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[#86909c]">地址：</span>
                  <span className="text-[#1d2129] ml-2">{ticket.waybillSnapshot.recipientAddress || "-"}</span>
                </div>
              </div>
            </div>
          )}

          {/* 审批记录（审计日志） */}
          {ticket.approvalRecords && ticket.approvalRecords.length > 0 && (
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
              <h2 className="text-base font-semibold text-[#1d2129] mb-4">审批记录（审计日志）</h2>
              <div className="space-y-3">
                {ticket.approvalRecords.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 p-3 bg-[#f7f8fa] rounded-lg">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      r.action === "approve" ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                    }`}>
                      {r.action === "approve" ? "✓" : "✗"}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#1d2129]">
                          {r.action === "approve" ? "审批通过" : "审批拒绝"}
                        </span>
                        <span className="text-xs text-[#86909c]">
                          {r.approverRole} · 第{r.level}级 · {r.triggeredBy === "auto_timeout" ? "自动超时" : r.triggeredBy === "auto_escalation" ? "自动升级" : "手动"}
                        </span>
                        <span className="text-xs text-[#86909c] ml-auto">{new Date(r.createdAt).toLocaleString("zh-CN")}</span>
                      </div>
                      {r.opinion && <p className="text-sm text-[#4e5969] mt-1">{r.opinion}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 赔付记录 */}
          {ticket.compensationRecord && (
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
              <h2 className="text-base font-semibold text-[#1d2129] mb-4">赔付记录</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[#86909c]">赔付方向：</span>
                  <span className={`ml-2 px-2 py-0.5 rounded text-xs ${ticket.compensationRecord.compensationDirection === "to_customer" ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"}`}>
                    {ticket.compensationRecord.compensationDirection === "to_customer" ? "赔付客户" : "向供应商追偿"}
                  </span>
                </div>
                <div>
                  <span className="text-[#86909c]">赔付金额：</span>
                  <span className="text-[#1d2129] ml-2">¥{ticket.compensationRecord.amount.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#86909c]">状态：</span>
                  <span className="text-[#1d2129] ml-2">{ticket.compensationRecord.status === "processed" ? "已处理" : "待处理"}</span>
                </div>
                {ticket.compensationRecord.description && (
                  <div className="col-span-2">
                    <span className="text-[#86909c]">说明：</span>
                    <span className="text-[#1d2129] ml-2">{ticket.compensationRecord.description}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 审批操作区 */}
        <div className="space-y-6">
          {canApprove && (
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
              <h2 className="text-base font-semibold text-[#1d2129] mb-4">审批操作</h2>
              
              {isSelfReport ? (
                <div className="p-3 bg-[#fff7e8] rounded-lg text-sm text-[#d97b00]">
                  不能审批自己上报的工单
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#4e5969] mb-1">审批意见</label>
                    <textarea
                      value={opinion}
                      onChange={(e) => setOpinion(e.target.value)}
                      placeholder="输入审批意见（可选）"
                      rows={3}
                      className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleApproval("approve")}
                      disabled={approving}
                      className="bg-[#0fc6c2] text-white rounded-lg py-2 text-sm font-medium hover:bg-[#0bada9] transition-colors disabled:opacity-50"
                    >
                      {approving ? "处理中..." : "通过"}
                    </button>
                    <button
                      onClick={() => handleApproval("reject")}
                      disabled={approving}
                      className="border border-red-300 text-red-600 rounded-lg py-2 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {approving ? "处理中..." : "拒绝"}
                    </button>
                  </div>
                </div>
              )}

              {/* 快速放行（品控主管专用） */}
              {canFastRelease && (
                <div className="mt-4 pt-4 border-t border-[#f2f3f5]">
                  {!showFastRelease ? (
                    <button
                      onClick={() => setShowFastRelease(true)}
                      className="w-full border border-[#ba7517] text-[#ba7517] rounded-lg py-2 text-sm font-medium hover:bg-[#faf0dc] transition-colors"
                    >
                      品控主管 - 快速放行
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-[#ba7517]">仅品控主管可操作，需填写复核原因（留痕记录）</p>
                      <textarea
                        value={fastReleaseReason}
                        onChange={(e) => setFastReleaseReason(e.target.value)}
                        placeholder="请输入复核原因（必填）"
                        rows={2}
                        className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={handleFastRelease}
                          disabled={approving}
                          className="bg-[#ba7517] text-white rounded-lg py-2 text-sm font-medium hover:bg-[#9a6113] transition-colors disabled:opacity-50"
                        >
                          确认放行
                        </button>
                        <button
                          onClick={() => { setShowFastRelease(false); setFastReleaseReason(""); }}
                          className="border border-[#e5e6eb] text-[#4e5969] rounded-lg py-2 text-sm hover:bg-[#f7f8fa]"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 审批历史 */}
          <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
            <h2 className="text-base font-semibold text-[#1d2129] mb-4">审批时间线</h2>
            {!ticket.approvalRecords || ticket.approvalRecords.length === 0 ? (
              <p className="text-sm text-[#86909c]">暂无审批记录</p>
            ) : (
              <div className="relative pl-5 border-l-2 border-[#e5e6eb] space-y-4">
                {ticket.approvalRecords.map((r) => (
                  <div key={r.id} className="relative">
                    <div className={`absolute -left-[25px] w-3 h-3 rounded-full border-2 ${
                      r.action === "approve" ? "bg-green-500 border-green-300" : "bg-red-500 border-red-300"
                    }`} />
                    <p className="text-sm text-[#1d2129]">
                      {r.action === "approve" ? "审批通过" : "审批拒绝"} - {r.approverRole}
                    </p>
                    <p className="text-xs text-[#86909c]">{new Date(r.createdAt).toLocaleString("zh-CN")}</p>
                    {r.opinion && <p className="text-xs text-[#4e5969] mt-1">&ldquo;{r.opinion}&rdquo;</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
