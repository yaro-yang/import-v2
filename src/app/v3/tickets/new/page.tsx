"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { MOCK_USERS, CurrentUser, EXCEPTION_TYPE_LABELS, ExceptionType } from "@/types";

const LOGISTICS_TYPES: ExceptionType[] = ["lost", "damaged", "rejected", "timeout", "address_error"];

function initV3() {
  return fetch("/api/v3/init").catch(() => {});
}

export default function NewTicketPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser>(MOCK_USERS[0]);
  const [waybillId, setWaybillId] = useState("");
  const [externalCode, setExternalCode] = useState("");
  const [searchMode, setSearchMode] = useState<"id" | "code">("id");
  const [exceptionType, setExceptionType] = useState<ExceptionType>("damaged");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [foundWaybill, setFoundWaybill] = useState<Record<string, unknown> | null>(null);

  const handleSearch = async () => {
    if (searchMode === "id" && !waybillId) {
      toast.error("请输入运单ID");
      return;
    }
    if (searchMode === "code" && !externalCode) {
      toast.error("请输入运单号");
      return;
    }

    setSearching(true);
    setFoundWaybill(null);
    try {
      const res = await fetch("/api/v2/external/waybills?" + new URLSearchParams(
        searchMode === "id" ? { externalCode: ""} : { externalCode }
      ), {
        headers: { "X-API-Key": "v3-system-api-key-2024" },
      });
      const data = await res.json();
      if (data.success) {
        if (searchMode === "id") {
          // 通过ID查询
          const idRes = await fetch(`/api/v2/external/waybills/${encodeURIComponent(waybillId)}`, {
            headers: { "X-API-Key": "v3-system-api-key-2024" },
          });
          const idData = await idRes.json();
          if (idData.success && idData.data) {
            setFoundWaybill(idData.data);
            toast.success("运单验证成功");
          } else {
            toast.error("运单不存在");
          }
        } else {
          if (data.data.orders?.length > 0) {
            setFoundWaybill(data.data.orders[0]);
            setWaybillId(data.data.orders[0].id);
            toast.success(`找到 ${data.data.total} 条运单`);
          } else {
            toast.error("未找到该运单");
          }
        }
      }
    } catch {
      toast.error("V2接口查询失败");
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foundWaybill) {
      toast.error("请先验证运单");
      return;
    }
    if (!description.trim()) {
      toast.error("请填写异常描述");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v3/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waybillId: (foundWaybill as Record<string, unknown>).id,
          externalCode: (foundWaybill as Record<string, unknown>).externalCode,
          exceptionType,
          description,
          amount,
          reporter: user.id,
          reporterRole: user.role,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`工单 ${data.data.ticketNo} 创建成功`);
        router.push(`/v3/tickets/${data.data.id}`);
      } else {
        toast.error(data.error || "创建失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initV3();
  }, []);

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#1d2129]">异常工单上报</h1>
        <p className="text-sm text-[#86909c] mt-1">手工上报物流异常工单</p>
      </div>

      {/* 角色选择 */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] p-4 card-enhanced">
        <div className="flex items-center gap-2">
          <label className="text-sm text-[#4e5969]">操作角色：</label>
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

      {/* 运单验证 */}
      <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
        <h2 className="text-base font-semibold text-[#1d2129] mb-4">步骤1：验证运单</h2>
        <div className="flex gap-3 mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={searchMode === "id"} onChange={() => setSearchMode("id")} />
            按运单ID
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={searchMode === "code"} onChange={() => setSearchMode("code")} />
            按运单号
          </label>
        </div>
        <div className="flex gap-3">
          {searchMode === "id" ? (
            <input
              type="text"
              value={waybillId}
              onChange={(e) => setWaybillId(e.target.value)}
              placeholder="输入V2运单ID"
              className="flex-1 border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
            />
          ) : (
            <input
              type="text"
              value={externalCode}
              onChange={(e) => setExternalCode(e.target.value)}
              placeholder="输入运单号"
              className="flex-1 border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
            />
          )}
          <button
            onClick={handleSearch}
            disabled={searching}
            className="bg-[#0fc6c2] text-white rounded-lg px-4 py-2 text-sm hover:bg-[#0bada9] transition-colors disabled:opacity-50"
          >
            {searching ? "查询中..." : "验证运单"}
          </button>
        </div>
        {foundWaybill && (
          <div className="mt-4 p-3 bg-[#f0fdf4] rounded-lg">
            <p className="text-sm text-green-700">✅ 运单验证通过</p>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-[#4e5969]">
              <p>ID: {(foundWaybill as Record<string, unknown>).id as string}</p>
              <p>运单号: {(foundWaybill as Record<string, unknown>).externalCode as string || "-"}</p>
              <p>门店: {(foundWaybill as Record<string, unknown>).storeName as string || "-"}</p>
              <p>收件人: {(foundWaybill as Record<string, unknown>).recipientName as string || "-"}</p>
              <p className="col-span-2">地址: {(foundWaybill as Record<string, unknown>).recipientAddress as string || "-"}</p>
            </div>
          </div>
        )}
      </div>

      {/* 工单信息 */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced space-y-4">
        <h2 className="text-base font-semibold text-[#1d2129]">步骤2：填写异常信息</h2>

        <div>
          <label className="block text-sm font-medium text-[#4e5969] mb-1">异常类型 *</label>
          <select
            value={exceptionType}
            onChange={(e) => setExceptionType(e.target.value as ExceptionType)}
            className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            {LOGISTICS_TYPES.map((t) => (
              <option key={t} value={t}>{EXCEPTION_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#4e5969] mb-1">异常描述 *</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="详细描述异常情况..."
            rows={4}
            className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#4e5969] mb-1">涉及金额（元）</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
          />
        </div>

        <div className="bg-[#f7f8fa] p-4 rounded-lg text-xs text-[#86909c] space-y-1">
          <p>异常类型对应的处理动作：</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>丢件：理赔 + 重新发货（赔付客户）</li>
            <li>破损：理赔 + 退货入库（赔付客户）</li>
            <li>客户拒收：退货入库（一般不赔付）</li>
            <li>超时未签收：重新发货（一般不赔付）</li>
            <li>地址错误：重新发货（一般不赔付）</li>
          </ul>
        </div>

        <button
          type="submit"
          disabled={loading || !foundWaybill}
          className="w-full bg-[#0fc6c2] text-white rounded-lg py-2.5 font-medium text-sm hover:bg-[#0bada9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "提交中..." : "提交异常工单"}
        </button>
      </form>
    </div>
  );
}
