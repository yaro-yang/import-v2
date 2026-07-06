"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { MOCK_USERS, CurrentUser, EXCEPTION_TYPE_LABELS, ExceptionType } from "@/types";

const LOGISTICS_TYPES: ExceptionType[] = ["lost", "damaged", "rejected", "timeout", "address_error"];

function initV3() { return fetch("/api/v3/init").catch(() => {}); }

export default function NewTicketPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser>(MOCK_USERS[0]);
  const [waybillId, setWaybillId] = useState("");
  const [externalCode, setExternalCode] = useState("");
  const [searchMode, setSearchMode] = useState<"id" | "code">("code");
  const [exceptionType, setExceptionType] = useState<ExceptionType>("damaged");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [foundWaybill, setFoundWaybill] = useState<Record<string, unknown> | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<{ type: string; label: string; confidence: number }[]>([]);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);

  const handleSearch = async () => {
    if (searchMode === "id" && !waybillId) { toast.error("请输入运单ID"); return; }
    if (searchMode === "code" && !externalCode) { toast.error("请输入运单号"); return; }
    setSearching(true); setFoundWaybill(null);
    try {
      if (searchMode === "id") {
        const res = await fetch(`/api/v2/external/waybills/${encodeURIComponent(waybillId)}`, { headers: { "X-API-Key": "v3-system-api-key-2024" } });
        const data = await res.json();
        if (data.success && data.data) { setFoundWaybill(data.data); toast.success("运单验证成功"); }
        else toast.error("运单不存在");
      } else {
        const res = await fetch(`/api/v2/external/waybills?externalCode=${encodeURIComponent(externalCode)}`, { headers: { "X-API-Key": "v3-system-api-key-2024" } });
        const data = await res.json();
        if (data.success && data.data.orders?.length > 0) {
          setFoundWaybill(data.data.orders[0]);
          setWaybillId(data.data.orders[0].id as string);
          toast.success(`找到运单`);
        } else toast.error("未找到该运单");
      }
    } catch { toast.error("V2接口查询失败"); }
    finally { setSearching(false); }
  };

  // AI 异常类型建议
  const handleAISuggest = async () => {
    if (!description || description.trim().length < 5) { toast.error("请先填写异常描述（至少5个字）"); return; }
    setAiLoading(true);
    try {
      const res = await fetch("/api/v3/ai/suggest-type", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (data.success) {
        setAiSuggestions(data.data.suggestions || []);
        setAiResult(data.data.aiSuggestion || null);
        if (data.data.aiSuggestion && (data.data.aiSuggestion as Record<string, unknown>).type) {
          const aiType = (data.data.aiSuggestion as Record<string, unknown>).type as string;
          if (LOGISTICS_TYPES.includes(aiType as ExceptionType)) {
            setExceptionType(aiType as ExceptionType);
            toast.success(`AI 建议类型：${EXCEPTION_TYPE_LABELS[aiType as ExceptionType]}（需人工确认）`, { duration: 5000 });
          }
        }
      }
    } catch { /* AI失败不影响主流程 */ }
    finally { setAiLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foundWaybill) { toast.error("请先验证运单"); return; }
    if (!description.trim()) { toast.error("请填写异常描述"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/v3/tickets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waybillId: (foundWaybill as Record<string, unknown>).id, externalCode: (foundWaybill as Record<string, unknown>).externalCode, exceptionType, description, amount, reporter: user.id, reporterRole: user.role }),
      });
      const data = await res.json();
      if (data.success) { toast.success(`工单 ${data.data.ticketNo} 创建成功`); router.push(`/v3/tickets/${data.data.id}`); }
      else toast.error(data.error || "创建失败");
    } catch { toast.error("网络错误"); }
    finally { setLoading(false); }
  };

  useEffect(() => { initV3(); }, []);

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#1d2129]">异常工单上报</h1>
        <p className="text-sm text-[#86909c] mt-1">手工上报物流异常工单，系统将自动调用 V2 接口校验运单真实性</p>
      </div>

      {/* Role selector */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] p-4 card-enhanced flex items-center gap-3">
        <span className="text-sm text-[#4e5969]">操作角色：</span>
        <select value={user.id} onChange={e => setUser(MOCK_USERS.find(u => u.id === e.target.value) || MOCK_USERS[0])} className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 focus:outline-none bg-white">
          {MOCK_USERS.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {/* Step 1: Verify waybill */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-6 h-6 rounded-full bg-[#0fc6c2] text-white text-xs flex items-center justify-center font-bold">1</span>
          <h2 className="text-base font-semibold text-[#1d2129]">验证运单</h2>
        </div>
        <div className="flex gap-3 mb-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" checked={searchMode === "id"} onChange={() => setSearchMode("id")} className="accent-[#0fc6c2]" />按运单ID</label>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" checked={searchMode === "code"} onChange={() => setSearchMode("code")} className="accent-[#0fc6c2]" />按运单号</label>
        </div>
        <div className="flex gap-3">
          {searchMode === "id"
            ? <input type="text" value={waybillId} onChange={e => setWaybillId(e.target.value)} placeholder="输入V2运单ID" className="flex-1 border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none" />
            : <input type="text" value={externalCode} onChange={e => setExternalCode(e.target.value)} placeholder="输入运单号（如 PS2512220005001）" className="flex-1 border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none" />
          }
          <button onClick={handleSearch} disabled={searching} className="bg-[#0fc6c2] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#0bada9] disabled:opacity-50 transition-colors">{searching ? "查询中..." : "验证运单"}</button>
        </div>
        {foundWaybill && (
          <div className="mt-4 p-4 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg">
            <p className="text-sm font-medium text-green-700 mb-2">✅ 运单验证通过（通过 V2 接口实时校验）</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-[#4e5969]">
              <p>ID: {(foundWaybill as Record<string, unknown>).id as string}</p>
              <p>运单号: {(foundWaybill as Record<string, unknown>).externalCode as string || "-"}</p>
              <p>门店: {(foundWaybill as Record<string, unknown>).storeName as string || "-"}</p>
              <p>收件人: {(foundWaybill as Record<string, unknown>).recipientName as string || "-"}</p>
              <p className="col-span-2">地址: {(foundWaybill as Record<string, unknown>).recipientAddress as string || "-"}</p>
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Exception info */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-6 h-6 rounded-full bg-[#0fc6c2] text-white text-xs flex items-center justify-center font-bold">2</span>
          <h2 className="text-base font-semibold text-[#1d2129]">填写异常信息</h2>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#4e5969] mb-1">异常类型 *</label>
          <select value={exceptionType} onChange={e => setExceptionType(e.target.value as ExceptionType)} className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none bg-white">
            {LOGISTICS_TYPES.map(t => <option key={t} value={t}>{EXCEPTION_TYPE_LABELS[t]}</option>)}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-[#4e5969]">异常描述 *</label>
            <button type="button" onClick={handleAISuggest} disabled={aiLoading} className="text-xs text-[#0fc6c2] hover:text-[#0bada9] flex items-center gap-1 disabled:opacity-50">
              {aiLoading ? <span className="w-3 h-3 border border-[#0fc6c2] border-t-transparent rounded-full animate-spin" /> : "🤖"}
              {aiLoading ? "AI分析中..." : "AI 分类建议"}
            </button>
          </div>
          <textarea value={description} onChange={e => { setDescription(e.target.value); setAiSuggestions([]); setAiResult(null); }} placeholder="详细描述异常情况，AI 可辅助分类..." rows={4} className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" required />
        </div>

        {/* AI Suggestions */}
        {(aiSuggestions.length > 0 || aiResult) && (
          <div className="p-4 bg-[#f0faf9] border border-[#e8fafa] rounded-lg space-y-2">
            <p className="text-xs font-medium text-[#0bada9] flex items-center gap-1">🤖 AI 分析结果</p>
            {aiResult && (
              <div className="p-2 bg-white rounded border border-[#e8fafa]">
                <p className="text-xs text-[#4e5969]">
                  <span className="text-[#d97b00] font-medium">⚠️ AI 建议，需人工确认：</span>
                  {EXCEPTION_TYPE_LABELS[(aiResult as Record<string, unknown>).type as ExceptionType] || (aiResult as Record<string, unknown>).type as string}
                </p>
                <p className="text-[10px] text-[#86909c] mt-0.5">置信度：{Math.round(((aiResult as Record<string, unknown>).confidence as number || 0) * 100)}% · {(aiResult as Record<string, unknown>).explanation as string}</p>
              </div>
            )}
            {aiSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {aiSuggestions.map((s, i) => (
                  <button key={i} type="button" onClick={() => { if (LOGISTICS_TYPES.includes(s.type as ExceptionType)) setExceptionType(s.type as ExceptionType); }}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${s.type === exceptionType ? "bg-[#0fc6c2] text-white border-[#0fc6c2]" : "bg-white text-[#4e5969] border-[#e5e6eb] hover:border-[#0fc6c2]"}`}>
                    {s.label} ({Math.round(s.confidence * 100)}%)
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[#4e5969] mb-1">涉及金额（元）</label>
          <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="0.00" />
        </div>

        <div className="bg-[#f7f8fa] p-4 rounded-lg text-xs text-[#86909c] space-y-1">
          <p className="font-medium text-[#4e5969] mb-1">异常类型处理说明：</p>
          <ul className="space-y-0.5">
            <li>📦 <strong>丢件</strong>：理赔 + 重新发货（赔付客户）</li>
            <li>📦 <strong>破损</strong>：理赔 + 退货入库（赔付客户）</li>
            <li>📦 <strong>客户拒收</strong>：退货入库（一般不赔付）</li>
            <li>📦 <strong>超时未签收</strong>：重新发货（一般不赔付）</li>
            <li>📦 <strong>地址错误</strong>：重新发货（一般不赔付）</li>
          </ul>
        </div>

        <button type="submit" disabled={loading || !foundWaybill} className="w-full bg-[#0fc6c2] text-white rounded-lg py-2.5 font-medium text-sm hover:bg-[#0bada9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {loading ? "提交中..." : "提交异常工单"}
        </button>
      </form>
    </div>
  );
}
