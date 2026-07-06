"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { MOCK_USERS, CurrentUser } from "@/types";

function initV3() {
  return fetch("/api/v3/init").catch(() => {});
}

type ScanResult = {
  scanResult: "pass" | "fail" | "duplicate";
  message: string;
  failReason?: string;
  ruleMatches?: { ruleId?: string; ruleName: string; reason: string; severity: string }[];
  ticketId?: string;
  ticketNo?: string;
  batchStatus?: string;
  timeoutAt?: string;
  existingTicketId?: string;
  existingTicketNo?: string;
};

export default function ScanPage() {
  const [user, setUser] = useState<CurrentUser>(MOCK_USERS[0]);
  const [waybillId, setWaybillId] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [skuName, setSkuName] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [damageLevel, setDamageLevel] = useState<number>(0);
  const [actualQuantity, setActualQuantity] = useState<number>(0);
  const [specDeviation, setSpecDeviation] = useState(false);
  const [labelMatch, setLabelMatch] = useState(true);
  const [batchValid, setBatchValid] = useState(true);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  useEffect(() => {
    initV3();
  }, []);

  const handleScan = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waybillId || !skuCode) {
      toast.error("请填写运单ID和SKU编码");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/v3/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waybillId,
          skuCode,
          skuName,
          batchNo,
          operator: user.id,
          operatorRole: user.role,
          damageLevel: Number(damageLevel),
          actualQuantity: Number(actualQuantity),
          specDeviation,
          labelMatch,
          batchValid,
          description,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
        if (data.data.scanResult === "pass") {
          toast.success("品控检测通过");
        } else if (data.data.scanResult === "duplicate") {
          toast(data.data.message || "重复扫描", { icon: "⚠️" });
        } else {
          toast.error(`品控异常：${data.data.failReason || "检测未通过"}`);
        }
      } else {
        toast.error(data.error || "扫描失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setLoading(false);
    }
  }, [waybillId, skuCode, skuName, batchNo, user, damageLevel, actualQuantity, specDeviation, labelMatch, batchValid, description]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1d2129]">扫描品控</h1>
          <p className="text-sm text-[#86909c] mt-1">扫描录入SKU，自动执行品控规则检测</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 扫描表单 */}
        <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
          <h2 className="text-base font-semibold text-[#1d2129] mb-4">扫描录入</h2>
          <form onSubmit={handleScan} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#4e5969] mb-1">运单 ID *</label>
              <input
                type="text"
                value={waybillId}
                onChange={(e) => setWaybillId(e.target.value)}
                placeholder="输入V2运单ID"
                className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#4e5969] mb-1">SKU 编码 *</label>
                <input
                  type="text"
                  value={skuCode}
                  onChange={(e) => setSkuCode(e.target.value)}
                  placeholder="扫描或输入SKU"
                  className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4e5969] mb-1">SKU 名称</label>
                <input
                  type="text"
                  value={skuName}
                  onChange={(e) => setSkuName(e.target.value)}
                  placeholder="货物名称"
                  className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#4e5969] mb-1">批次号</label>
              <input
                type="text"
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                placeholder="货物批次号"
                className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>

            <div className="border-t border-[#f2f3f5] pt-4">
              <h3 className="text-sm font-semibold text-[#4e5969] mb-3">品控检测参数</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[#86909c] mb-1">实际数量</label>
                  <input
                    type="number"
                    value={actualQuantity}
                    onChange={(e) => setActualQuantity(Number(e.target.value))}
                    className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#86909c] mb-1">破损等级 (0-5)</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    value={damageLevel}
                    onChange={(e) => setDamageLevel(Number(e.target.value))}
                    className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <label className="flex items-center gap-2 text-sm text-[#4e5969]">
                  <input type="checkbox" checked={specDeviation} onChange={(e) => setSpecDeviation(e.target.checked)} className="rounded" />
                  规格偏差
                </label>
                <label className="flex items-center gap-2 text-sm text-[#4e5969]">
                  <input type="checkbox" checked={!labelMatch} onChange={(e) => setLabelMatch(!e.target.checked)} className="rounded" />
                  标签不匹配
                </label>
                <label className="flex items-center gap-2 text-sm text-[#4e5969]">
                  <input type="checkbox" checked={!batchValid} onChange={(e) => setBatchValid(!e.target.checked)} className="rounded" />
                  批次异常
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4e5969] mb-1">异常描述（可选）</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述扫描发现的问题..."
                rows={2}
                className="w-full border border-[#e5e6eb] rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#0fc6c2] text-white rounded-lg py-2.5 font-medium text-sm hover:bg-[#0bada9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "检测中..." : "执行品控检测"}
            </button>
          </form>
        </div>

        {/* 检测结果 */}
        <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
          <h2 className="text-base font-semibold text-[#1d2129] mb-4">检测结果</h2>
          {!result ? (
            <div className="flex flex-col items-center justify-center h-64 text-[#86909c]">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-30">
                <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <line x1="7" y1="12" x2="17" y2="12" />
              </svg>
              <p>填写左侧表单并点击&ldquo;执行品控检测&rdquo;</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className={`p-4 rounded-lg ${
                result.scanResult === "pass"
                  ? "bg-[#f0fdf4] border border-[#bbf7d0]"
                  : result.scanResult === "duplicate"
                  ? "bg-[#fff7e8] border border-[#ffe4ba]"
                  : "bg-[#fff1f0] border border-[#ffccc7]"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-3 h-3 rounded-full ${
                    result.scanResult === "pass" ? "bg-green-500" : result.scanResult === "duplicate" ? "bg-yellow-500" : "bg-red-500"
                  }`} />
                  <span className="font-semibold text-sm">
                    {result.scanResult === "pass" ? "✅ 品控通过" : result.scanResult === "duplicate" ? "⚠️ 重复扫描" : "❌ 品控异常"}
                  </span>
                </div>
                <p className="text-sm text-[#4e5969]">{result.message}</p>
              </div>

              {result.ruleMatches && result.ruleMatches.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-[#4e5969] mb-2">规则命中详情</h3>
                  <div className="space-y-2">
                    {result.ruleMatches.map((m, i) => (
                      <div key={i} className="p-3 bg-[#f7f8fa] rounded-lg text-xs">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-[#1d2129]">{m.ruleName}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            m.severity === "critical" ? "bg-red-100 text-red-600" :
                            m.severity === "high" ? "bg-orange-100 text-orange-600" :
                            m.severity === "medium" ? "bg-yellow-100 text-yellow-600" :
                            "bg-blue-100 text-blue-600"
                          }`}>
                            {m.severity}
                          </span>
                        </div>
                        <p className="text-[#86909c]">{m.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.ticketId && (
                <div className="p-3 bg-[#e8fafa] rounded-lg">
                  <p className="text-sm text-[#0bada9]">
                    已自动创建工单：<strong>{result.ticketNo}</strong>
                  </p>
                  <p className="text-xs text-[#4a9a95] mt-1">批次已锁定（品控暂扣），超时 {result.timeoutAt ? new Date(result.timeoutAt).toLocaleString("zh-CN") : "-"}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
