"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import { ExceptionTicket, EXCEPTION_TYPE_LABELS, TICKET_STATUS_LABELS, MOCK_USERS, CurrentUser } from "@/types";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700 border-yellow-300",
  level1_review: "bg-blue-100 text-blue-700 border-blue-300",
  level2_review: "bg-purple-100 text-purple-700 border-purple-300",
  executing: "bg-teal-100 text-teal-700 border-teal-300",
  completed: "bg-green-100 text-green-700 border-green-300",
  rejected_final: "bg-red-100 text-red-700 border-red-300",
};

const STATUS_STEPS = [
  { key: "pending", label: "待审批", icon: "📋" },
  { key: "level1_review", label: "一级审批", icon: "🔍" },
  { key: "level2_review", label: "二级审批", icon: "🔬" },
  { key: "executing", label: "执行中", icon: "⚙️" },
  { key: "completed", label: "已完成", icon: "✅" },
];

export default function TicketDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [ticket, setTicket] = useState<ExceptionTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [user, setUser] = useState<CurrentUser>(MOCK_USERS[2]);
  const [opinion, setOpinion] = useState("");
  const [showFastRelease, setShowFastRelease] = useState(false);
  const [fastReleaseReason, setFastReleaseReason] = useState("");
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);

  const fetchTicket = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v3/tickets/${id}`);
      const data = await res.json();
      if (data.success) setTicket(data.data);
      else toast.error(data.error || "获取工单失败");
    } catch { toast.error("网络错误"); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    fetch("/api/v3/init").then(() => fetchTicket());
  }, [fetchTicket]);

  const doApproval = async (action: "approve" | "reject") => {
    setConfirmAction(null);
    setApproving(true);
    try {
      const res = await fetch("/api/v3/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: id, approver: user.id, approverRole: user.role, action, opinion, triggeredBy: "manual" }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || (action === "approve" ? "审批通过" : "已拒绝"));
        setOpinion("");
        fetchTicket();
      } else {
        toast.error(data.error || "操作失败");
      }
    } catch { toast.error("网络错误"); }
    finally { setApproving(false); }
  };

  const handleApproval = (action: "approve" | "reject") => {
    if (!user.role.includes("approver") && user.role !== "admin") { toast.error("您没有审批权限"); return; }
    if (ticket?.reporter === user.id) { toast.error("不能审批自己上报的工单"); return; }
    setConfirmAction(action);
  };

  const handleFastRelease = async () => {
    if (!fastReleaseReason.trim()) { toast.error("请填写复核原因"); return; }
    if (user.role !== "qc_supervisor" && user.role !== "admin") { toast.error("仅品控主管可执行快速放行"); return; }
    setApproving(true);
    try {
      const res = await fetch("/api/v3/fast-release", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: id, operator: user.id, operatorRole: user.role, reason: fastReleaseReason }),
      });
      const data = await res.json();
      if (data.success) { toast.success("快速放行成功"); setShowFastRelease(false); setFastReleaseReason(""); fetchTicket(); }
      else toast.error(data.error || "操作失败");
    } catch { toast.error("网络错误"); }
    finally { setApproving(false); }
  };

  const canApprove = ticket && ["pending", "level1_review", "level2_review"].includes(ticket.status);
  const isSelfReport = ticket?.reporter === user.id;
  const canFastRelease = ticket?.exceptionSource === "scan_trigger" && canApprove;

  const currentStepIdx = STATUS_STEPS.findIndex(s => s.key === ticket?.status);
  const isRejected = ticket?.status === "rejected_final";

  if (loading) return <div className="animate-fade-in flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#0fc6c2] border-t-transparent rounded-full animate-spin" /></div>;
  if (!ticket) return <div className="animate-fade-in flex items-center justify-center h-64"><p className="text-[#86909c]">工单不存在</p></div>;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmAction(null)}>
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[#1d2129] mb-2">确认{confirmAction === "approve" ? "通过" : "拒绝"}</h3>
            <p className="text-sm text-[#4e5969] mb-4">
              {confirmAction === "approve"
                ? `确认审批通过工单 ${ticket.ticketNo}？${ticket.amount > 5000 ? "金额超过阈值将进入二级审批。" : "将进入执行阶段。"}`
                : `确认拒绝工单 ${ticket.ticketNo}？剩余重提次数：${ticket.maxRejectCount - ticket.rejectCount - 1}次`
              }
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmAction(null)} className="flex-1 border border-[#e5e6eb] rounded-lg py-2 text-sm hover:bg-[#f7f8fa]">取消</button>
              <button onClick={() => doApproval(confirmAction)} className={`flex-1 rounded-lg py-2 text-sm text-white font-medium ${confirmAction === "approve" ? "bg-[#0fc6c2] hover:bg-[#0bada9]" : "bg-red-500 hover:bg-red-600"}`}>
                确认{confirmAction === "approve" ? "通过" : "拒绝"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1d2129]">工单详情 - {ticket.ticketNo}</h1>
          <p className="text-sm text-[#86909c] mt-1">
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[ticket.status]}`}>
              {TICKET_STATUS_LABELS[ticket.status]}
            </span>
          </p>
        </div>
        <select value={user.id} onChange={e => setUser(MOCK_USERS.find(u => u.id === e.target.value) || MOCK_USERS[0])} className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 focus:outline-none">
          {MOCK_USERS.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {/* Status Progress Bar */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
        <div className="flex items-center justify-between">
          {STATUS_STEPS.map((step, idx) => {
            let state: "done" | "current" | "future" = "future";
            if (isRejected) state = idx <= 1 ? "done" : "future";
            else if (idx < currentStepIdx) state = "done";
            else if (idx === currentStepIdx) state = "current";
            return (
              <div key={step.key} className="flex flex-col items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mb-1 ${
                  state === "done" ? "bg-[#0fc6c2] text-white" :
                  state === "current" ? "bg-[#e8fafa] text-[#0fc6c2] border-2 border-[#0fc6c2]" :
                  "bg-[#f2f3f5] text-[#86909c]"
                }`}>
                  {state === "done" ? "✓" : step.icon}
                </div>
                <span className={`text-[10px] font-medium ${state === "done" || state === "current" ? "text-[#1d2129]" : "text-[#86909c]"}`}>{step.label}</span>
                {idx < STATUS_STEPS.length - 1 && (
                  <div className="absolute w-full h-0.5 -z-10" style={{ display: "none" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
            <h2 className="text-base font-semibold text-[#1d2129] mb-4 flex items-center gap-2">
              <span>基本信息</span>
              {ticket.exceptionSource === "scan_trigger" && (
                <span className="text-[10px] bg-[#faf0dc] text-[#ba7517] px-2 py-0.5 rounded-full">扫描触发</span>
              )}
              {ticket.exceptionSource === "manual" && (
                <span className="text-[10px] bg-[#e6f1fb] text-[#185fa5] px-2 py-0.5 rounded-full">手工上报</span>
              )}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {[
                { label: "工单号", value: ticket.ticketNo, highlight: true },
                { label: "异常类型", value: EXCEPTION_TYPE_LABELS[ticket.exceptionType] },
                { label: "金额", value: `¥${ticket.amount.toFixed(2)}` },
                { label: "上报人", value: ticket.reporterRole === "qc_supervisor" ? "品控主管" : "操作员" },
                { label: "当前层级", value: `第 ${ticket.currentLevel || "-"} 级` },
                { label: "重提次数", value: `${ticket.rejectCount}/${ticket.maxRejectCount}` },
                { label: "创建时间", value: new Date(ticket.createdAt).toLocaleString("zh-CN"), span: 2 },
                ...(ticket.timeoutAt ? [{ label: "超时时间", value: new Date(ticket.timeoutAt).toLocaleString("zh-CN"), warn: new Date(ticket.timeoutAt).getTime() < Date.now(), span: 2 }] : []),
              ].map((item, i) => (
                <div key={i} className={item.span === 2 ? "col-span-2" : ""}>
                  <span className="text-[#86909c] text-xs">{item.label}</span>
                  <p className={`text-[#1d2129] font-medium mt-0.5 ${item.highlight ? "text-[#0fc6c2]" : ""} ${item.warn ? "text-red-500" : ""}`}>{item.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 p-4 bg-[#f7f8fa] rounded-lg">
              <p className="text-xs text-[#86909c] mb-1">异常描述</p>
              <p className="text-sm text-[#1d2129]">{ticket.description}</p>
            </div>
          </div>

          {/* Waybill Info */}
          {ticket.waybillSnapshot && (
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
              <h2 className="text-base font-semibold text-[#1d2129] mb-4">
                关联运单
                <span className="text-[10px] text-[#86909c] ml-2 bg-[#f7f8fa] px-2 py-0.5 rounded font-normal">
                  数据来源：本地缓存，同步于 {new Date(ticket.waybillSnapshot.syncedAt).toLocaleString("zh-CN")}
                </span>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                {[
                  { l: "运单ID", v: ticket.waybillSnapshot.waybillId },
                  { l: "运单号", v: ticket.waybillSnapshot.externalCode || "-" },
                  { l: "收件人", v: ticket.waybillSnapshot.recipientName || "-" },
                  { l: "门店", v: ticket.waybillSnapshot.storeName || "-" },
                  { l: "电话", v: ticket.waybillSnapshot.recipientPhone || "-" },
                  { l: "地址", v: ticket.waybillSnapshot.recipientAddress || "-", span: 2 },
                ].map((it, i) => (
                  <div key={i} className={it.span === 2 ? "col-span-2" : ""}>
                    <span className="text-xs text-[#86909c]">{it.l}</span>
                    <p className="text-[#1d2129] text-xs mt-0.5 truncate">{it.v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approval Timeline */}
          {ticket.approvalRecords && ticket.approvalRecords.length > 0 && (
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
              <h2 className="text-base font-semibold text-[#1d2129] mb-4">审批时间线</h2>
              <div className="relative pl-8 border-l-2 border-[#e5e6eb] space-y-5">
                {ticket.approvalRecords.map((r) => (
                  <div key={r.id} className="relative">
                    <div className={`absolute -left-[34px] w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] ${
                      r.action === "approve" ? "bg-green-100 border-green-400 text-green-600" :
                      r.action === "reject" ? "bg-red-100 border-red-400 text-red-600" :
                      "bg-yellow-100 border-yellow-400 text-yellow-600"
                    }`}>
                      {r.action === "approve" ? "✓" : r.action === "reject" ? "✗" : "↑"}
                    </div>
                    <p className="text-sm font-medium text-[#1d2129]">
                      {r.action === "approve" ? "通过" : r.action === "reject" ? "拒绝" : "升级"} · {r.approverRole} · 第{r.level}级
                    </p>
                    <p className="text-xs text-[#86909c] mt-0.5">
                      {new Date(r.createdAt).toLocaleString("zh-CN")}
                      {r.triggeredBy !== "manual" && (
                        <span className="ml-2 text-[10px] bg-[#fff7e8] text-[#d97b00] px-1.5 py-0.5 rounded">
                          {r.triggeredBy === "auto_timeout" ? "自动超时" : "自动升级"}
                        </span>
                      )}
                    </p>
                    {r.opinion && <p className="text-xs text-[#4e5969] mt-1 bg-[#f7f8fa] p-2 rounded">&ldquo;{r.opinion}&rdquo;</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compensation */}
          {ticket.compensationRecord && (
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
              <h2 className="text-base font-semibold text-[#1d2129] mb-4">赔付记录</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-xs text-[#86909c]">赔付方向</span>
                  <p><span className={`text-xs px-2 py-0.5 rounded ${ticket.compensationRecord.compensationDirection === "to_customer" ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"}`}>
                    {ticket.compensationRecord.compensationDirection === "to_customer" ? "赔付客户" : "向供应商追偿"}
                  </span></p>
                </div>
                <div><span className="text-xs text-[#86909c]">金额</span><p className="font-medium">¥{ticket.compensationRecord.amount.toFixed(2)}</p></div>
                <div><span className="text-xs text-[#86909c]">状态</span><p>{ticket.compensationRecord.status === "processed" ? "已处理" : "待处理"}</p></div>
                <div className="col-span-2"><span className="text-xs text-[#86909c]">说明</span><p className="text-xs mt-0.5">{ticket.compensationRecord.description || "-"}</p></div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar - Approval Actions */}
        <div className="space-y-4">
          {canApprove && (
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-5 card-enhanced">
              <h2 className="text-sm font-semibold text-[#1d2129] mb-3">审批操作</h2>
              {isSelfReport ? (
                <div className="p-3 bg-[#fff7e8] rounded-lg text-sm text-[#d97b00] flex items-center gap-2">
                  <span>⚠️</span> 不能审批自己上报的工单
                </div>
              ) : (
                <>
                  <textarea value={opinion} onChange={e => setOpinion(e.target.value)} placeholder="输入审批意见（可选）" rows={3} className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none resize-none mb-3" />
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => handleApproval("approve")} disabled={approving} className="bg-[#0fc6c2] text-white rounded-lg py-2 text-sm font-medium hover:bg-[#0bada9] disabled:opacity-50 transition-colors">
                      {approving ? "处理中..." : "✓ 通过"}
                    </button>
                    <button onClick={() => handleApproval("reject")} disabled={approving} className="border border-red-300 text-red-600 rounded-lg py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors">
                      {approving ? "处理中..." : "✗ 拒绝"}
                    </button>
                  </div>
                </>
              )}

              {canFastRelease && (
                <div className="mt-3 pt-3 border-t border-[#f2f3f5]">
                  {!showFastRelease ? (
                    <button onClick={() => setShowFastRelease(true)} className="w-full border border-dashed border-[#ba7517] text-[#ba7517] rounded-lg py-2 text-xs font-medium hover:bg-[#faf0dc] transition-colors">
                      ⚡ 品控主管 · 快速放行
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] text-[#ba7517]">仅品控主管可操作，需填写复核原因（留痕）</p>
                      <textarea value={fastReleaseReason} onChange={e => setFastReleaseReason(e.target.value)} placeholder="复核原因（必填）" rows={2} className="w-full border border-[#e5e6eb] rounded-lg px-2 py-1.5 text-xs focus:outline-none resize-none" />
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={handleFastRelease} disabled={approving} className="bg-[#ba7517] text-white rounded-lg py-1.5 text-xs font-medium hover:bg-[#9a6113] disabled:opacity-50">确认放行</button>
                        <button onClick={() => { setShowFastRelease(false); setFastReleaseReason(""); }} className="border border-[#e5e6eb] text-[#4e5969] rounded-lg py-1.5 text-xs hover:bg-[#f7f8fa]">取消</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Info Card */}
          <div className="bg-white rounded-xl border border-[#e5e6eb] p-5 card-enhanced">
            <h2 className="text-sm font-semibold text-[#1d2129] mb-3">操作指南</h2>
            <div className="space-y-2 text-xs text-[#4e5969]">
              {ticket.status === "pending" && <p>当前工单等待一级审批。请填写审批意见后选择通过或拒绝。</p>}
              {ticket.status === "level1_review" && <p>一级审批中。通过将根据金额阈值判断是否进入二级审批。</p>}
              {ticket.status === "level2_review" && <p>二级审批中。通过后将自动进入执行阶段。</p>}
              {ticket.status === "executing" && <p>工单正在执行联动操作（赔付/库存变更等）。</p>}
              {ticket.status === "completed" && <p>✅ 工单已完成，所有联动操作已执行。</p>}
              {ticket.status === "rejected_final" && <p>工单已被最终驳回，超过最大重提次数。</p>}
              {ticket.exceptionSource === "scan_trigger" && <p className="text-[#ba7517]">此工单由品控扫描自动触发，品控主管可执行快速放行。</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
