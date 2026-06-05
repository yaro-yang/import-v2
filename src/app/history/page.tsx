"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { OrderItem } from "@/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, exportToExcel } from "@/lib/utils";

export default function HistoryPage() {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchExternalCode, setSearchExternalCode] = useState("");
  const [searchRecipientName, setSearchRecipientName] = useState("");
  const pageSize = 20;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchExternalCode) params.set("externalCode", searchExternalCode);
      if (searchRecipientName) params.set("recipientName", searchRecipientName);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const res = await fetch(`/api/orders?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        setOrders(data.data.orders);
        setTotal(data.data.total);
      } else {
        // API 返回错误时不弹 toast，静默处理
        console.error("API error:", data.error);
        setOrders([]);
        setTotal(0);
      }
    } catch (err) {
      // 网络错误时也不弹 toast，静默降级为空列表
      console.error("Failed to load orders:", err);
      setOrders([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, searchExternalCode, searchRecipientName]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleSearch = () => {
    setPage(1);
    loadOrders();
  };

  const handleExportAll = () => {
    try {
      const exportData = orders.map((order) => ({
        外部编码: order.externalCode || "",
        收货门店: order.storeName || "",
        收件人: order.recipientName || "",
        电话: order.recipientPhone || "",
        地址: order.recipientAddress || "",
        SKU编码: order.skuCode,
        SKU名称: order.skuName,
        发货数量: order.skuQuantity,
        规格型号: order.skuSpec || "",
        备注: order.remark || "",
        提交时间: order.submittedAt ? formatDate(order.submittedAt) : "",
        状态: order.status === "submitted" ? "已提交" : order.status === "error" ? "有错误" : "草稿",
      }));
      exportToExcel(exportData, `运单列表_${new Date().toLocaleDateString()}.xlsx`);
      toast.success("导出成功");
    } catch (err) {
      console.error("Export error:", err);
      toast.error("导出失败");
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4 lg:space-y-5 page-container">
      {/* 页面标题卡片 */}
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] overflow-hidden">
        <div className="flex items-center gap-3 p-4 lg:p-5">
          <div className="w-10 h-10 lg:w-11 lg:h-11 rounded-lg bg-gradient-to-br from-[#0fc6c2] to-[#0bada9] flex items-center justify-center text-white flex-shrink-0 shadow-[0_4px_10px_rgba(15,198,194,0.25)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base lg:text-lg font-semibold text-[#1d2129]">已导入运单</h1>
            <p className="text-xs lg:text-sm text-[#86909c] mt-0.5 hidden sm:block">
              查看已提交的历史运单，支持筛选与导出
            </p>
          </div>
        </div>
      </div>

      {/* 搜索栏 - 卡片式 */}
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-5">
        <div className="flex flex-wrap items-center gap-2 lg:gap-3 search-controls-sm">
          <div className="flex items-center gap-2 text-sm text-[#4e5969]">
            <span className="whitespace-nowrap">申请渠道</span>
            <select className="border border-[#d0d7de] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0fc6c2] bg-white min-w-[80px]">
              <option>全部</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm text-[#4e5969]">
            <span className="whitespace-nowrap">审核状态</span>
            <select className="border border-[#d0d7de] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0fc6c2] bg-white min-w-[80px]">
              <option>全部</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="搜索外部编码..."
            value={searchExternalCode}
            onChange={(e) => setSearchExternalCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-full sm:w-[180px] lg:w-[220px] px-3 py-2 text-sm border border-[#d0d7de] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20 placeholder:text-[#b5bbc3]"
          />
          <input
            type="text"
            placeholder="搜索收件人..."
            value={searchRecipientName}
            onChange={(e) => setSearchRecipientName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-full sm:w-[160px] lg:w-[200px] px-3 py-2 text-sm border border-[#d0d7de] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20 placeholder:text-[#b5bbc3]"
          />
          <div className="flex items-center gap-2 text-sm text-[#4e5969]">
            <span className="whitespace-nowrap">创建时间</span>
            <input type="date" className="border border-[#d0d7de] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0fc6c2] bg-white" />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSearch}>查询</Button>
            {orders.length > 0 && (
              <Button variant="secondary" size="sm" onClick={handleExportAll}>
                导出
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-[#f2f3f5] flex items-center gap-4 lg:gap-6 text-sm text-[#86909c] flex-wrap">
          <span>申请渠道：<span className="text-[#4e5969]">全部</span></span>
          <span>审核状态：<span className="text-[#4e5969]">全部</span></span>
          <span>创建时间：<span className="text-[#4e5969]">—</span></span>
        </div>
      </div>

      {/* 数据列表 - 卡片式 */}
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] overflow-hidden animate-fade-in">
        {loading ? (
          <div className="p-4 lg:p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="bg-[#f7f8fa] border-b border-[#e5e6eb]">
                    {["外部编码", "收货门店", "收件人", "SKU编码", "SKU名称", "数量", "提交时间", "状态"].map((h) => (
                      <th key={h} className="px-3 lg:px-4 py-3.5 text-left text-xs font-semibold text-[#4e5969]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-[#f2f3f5]">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-3 lg:px-4 py-3">
                          <div className="skeleton h-4 rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="暂无运单记录"
              description="导入并提交运单后，可在此查看历史记录"
              action={
                <Button size="sm" onClick={() => (window.location.href = "/")}>
                  去导入运单
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="bg-[#f7f8fa] border-b border-[#e5e6eb]">
                    <th className="px-4 lg:px-5 py-3.5 text-left text-sm font-semibold text-[#4e5969]">
                      外部编码
                    </th>
                    <th className="px-4 lg:px-5 py-3.5 text-left text-sm font-semibold text-[#4e5969]">
                      收货门店
                    </th>
                    <th className="px-4 lg:px-5 py-3.5 text-left text-sm font-semibold text-[#4e5969]">
                      收件人
                    </th>
                    <th className="px-4 lg:px-5 py-3.5 text-left text-sm font-semibold text-[#4e5969]">
                      SKU编码
                    </th>
                    <th className="px-4 lg:px-5 py-3.5 text-left text-sm font-semibold text-[#4e5969] hidden md:table-cell">
                      SKU名称
                    </th>
                    <th className="px-4 lg:px-5 py-3.5 text-right text-sm font-semibold text-[#4e5969]">
                      数量
                    </th>
                    <th className="px-4 lg:px-5 py-3.5 text-left text-sm font-semibold text-[#4e5969] hidden sm:table-cell">
                      提交时间
                    </th>
                    <th className="px-4 lg:px-5 py-3.5 text-center text-sm font-semibold text-[#4e5969] sticky-action-col">
                      状态
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, index) => (
                    <tr
                      key={order.id}
                      className={`border-b border-[#f2f3f5] hover:bg-[#fafbfc] transition-colors ${
                        index % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"
                      }`}
                    >
                      <td className="px-4 lg:px-5 py-3 text-sm text-[#1d2129] font-mono whitespace-nowrap">
                        {order.externalCode || "—"}
                      </td>
                      <td className="px-4 lg:px-5 py-3 text-sm text-[#4e5969] max-w-[120px] lg:max-w-[150px] truncate">
                        {order.storeName || "—"}
                      </td>
                      <td className="px-4 lg:px-5 py-3 text-sm text-[#4e5969] whitespace-nowrap">
                        {order.recipientName || "—"}
                      </td>
                      <td className="px-4 lg:px-5 py-3 text-sm text-[#4e5969] max-w-[100px] lg:max-w-[120px] truncate">
                        {order.skuCode}
                      </td>
                      <td className="px-4 lg:px-5 py-3 text-sm text-[#4e5969] max-w-[120px] lg:max-w-[150px] truncate hidden md:table-cell">
                        {order.skuName}
                      </td>
                      <td className="px-4 lg:px-5 py-3 text-sm text-[#1d2129] text-right font-medium whitespace-nowrap">
                        {order.skuQuantity}
                      </td>
                      <td className="px-4 lg:px-5 py-3 text-sm text-[#86909c] whitespace-nowrap hidden sm:table-cell">
                        {order.submittedAt
                          ? formatDate(order.submittedAt)
                          : formatDate(order.createdAt)}
                      </td>
                      <td className="px-4 lg:px-5 py-3 text-center sticky-action-col">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded whitespace-nowrap ${
                            order.status === "submitted"
                              ? "bg-[#e8fafa] text-[#0fc6c2]"
                              : order.status === "error"
                                ? "bg-[#fff1f0] text-[#cf1322]"
                                : "bg-[#f2f3f5] text-[#86909c]"
                          }`}
                        >
                          {order.status === "submitted"
                            ? "已提交"
                            : order.status === "error"
                              ? "有错误"
                              : "草稿"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页 - 鲸天风格 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-[#e5e6eb] bg-[#fafbfc]">
                <p className="text-sm text-[#86909c]">
                  共 {total} 条
                </p>
                <div className="flex items-center gap-1">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 text-sm border border-[#d0d7de] rounded hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    &lt;
                  </button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const pageNum = i + 1;
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`min-w-[32px] h-[28px] text-sm rounded transition-colors ${
                          page === pageNum
                            ? "bg-[#0fc6c2] text-white"
                            : "hover:bg-white border border-transparent"
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  {totalPages > 7 && (
                    <>
                      <span className="text-sm text-[#86909c] px-1">...</span>
                      <button
                        onClick={() => setPage(totalPages)}
                        className={`min-w-[32px] h-[28px] text-sm rounded transition-colors ${
                          page === totalPages
                            ? "bg-[#0fc6c2] text-white"
                            : "hover:bg-white border border-transparent"
                        }`}
                      >
                        {totalPages}
                      </button>
                    </>
                  )}
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 text-sm border border-[#d0d7de] rounded hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    &gt;
                  </button>
                  <span className="ml-2 text-sm text-[#86909c]">
                    前往第{" "}
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={page}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (v >= 1 && v <= totalPages) setPage(v);
                      }}
                      className="w-10 h-[24px] text-sm text-center border border-[#d0d7de] rounded outline-none focus:border-[#0fc6c2]"
                    />{" "}
                    页
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
