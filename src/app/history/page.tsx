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
        toast.error(data.error || "加载失败");
      }
    } catch (err) {
      console.error("Failed to load orders:", err);
      toast.error("加载运单列表失败");
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
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d2129]">已导入运单</h1>
          <p className="text-sm text-[#86909c] mt-1">
            查看所有历史导入的运单记录
          </p>
        </div>
        {orders.length > 0 && (
          <Button variant="secondary" onClick={handleExportAll}>
            📥 导出全部
          </Button>
        )}
      </div>

      {/* 搜索栏 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-4 mb-6">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="搜索外部编码..."
            value={searchExternalCode}
            onChange={(e) => setSearchExternalCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 px-3 py-2 text-sm border border-[#e5e6eb] rounded-lg focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
          />
          <input
            type="text"
            placeholder="搜索收件人..."
            value={searchRecipientName}
            onChange={(e) => setSearchRecipientName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 px-3 py-2 text-sm border border-[#e5e6eb] rounded-lg focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2] outline-none"
          />
          <Button onClick={handleSearch}>搜索</Button>
        </div>
      </div>

      {/* 数据列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] overflow-hidden">
        {loading ? (
          <div className="text-center py-16">
            <div className="w-8 h-8 border-2 border-[#e5e6eb] border-t-[#0fc6c2] rounded-full animate-spin mx-auto" />
            <p className="text-sm text-[#86909c] mt-3">加载中...</p>
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon="📋"
            title="暂无运单记录"
            description="导入并提交运单后，可在此查看历史记录"
            action={
              <Button onClick={() => (window.location.href = "/")}>
                去导入运单
              </Button>
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#f7f8fa] border-b border-[#e5e6eb]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#4e5969]">
                      外部编码
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#4e5969]">
                      收货门店
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#4e5969]">
                      收件人
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#4e5969]">
                      SKU编码
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#4e5969]">
                      SKU名称
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-[#4e5969]">
                      数量
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#4e5969]">
                      提交时间
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-[#4e5969]">
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
                      <td className="px-4 py-3 text-sm text-[#1d2129] font-mono">
                        {order.externalCode || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4e5969] max-w-[150px] truncate">
                        {order.storeName || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4e5969]">
                        {order.recipientName || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4e5969] max-w-[120px] truncate">
                        {order.skuCode}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4e5969] max-w-[150px] truncate">
                        {order.skuName}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#1d2129] text-right font-medium">
                        {order.skuQuantity}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#86909c]">
                        {order.submittedAt
                          ? formatDate(order.submittedAt)
                          : formatDate(order.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                            order.status === "submitted"
                              ? "bg-[#e8fafa] text-[#0fc6c2]"
                              : order.status === "error"
                                ? "bg-[#fff1f0] text-[#cf1322]"
                                : "bg-[#f7f8fa] text-[#86909c]"
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

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#e5e6eb]">
                <p className="text-sm text-[#86909c]">
                  共 {total} 条记录，第 {page}/{totalPages} 页
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
