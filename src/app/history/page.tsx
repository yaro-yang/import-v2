"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { OutboundOrder } from "@/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { formatDate, exportToExcel } from "@/lib/utils";

export default function HistoryPage() {
  const [orders, setOrders] = useState<OutboundOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchExternalCode, setSearchExternalCode] = useState("");
  const [searchRecipientName, setSearchRecipientName] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // 待删除的运单
  const [deletingOrder, setDeletingOrder] = useState<OutboundOrder | null>(null);
  const [deleting, setDeleting] = useState(false);
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
        // 默认展开第一页所有
        setExpandedIds(new Set(data.data.orders.map((o: OutboundOrder) => o.id)));
      } else {
        console.error("API error:", data.error);
        setOrders([]);
        setTotal(0);
      }
    } catch (err) {
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

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 触发删除（弹出确认）
  const handleDeleteClick = (e: React.MouseEvent, ob: OutboundOrder) => {
    e.stopPropagation(); // 防止冒泡到展开/折叠
    setDeletingOrder(ob);
  };

  // 确认删除
  const handleConfirmDelete = async () => {
    if (!deletingOrder) return;
    setDeleting(true);
    const toastId = toast.loading("正在删除...");
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(deletingOrder.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success("已删除", { id: toastId });
        setDeletingOrder(null);
        // 重新加载列表
        loadOrders();
      } else {
        toast.error(data.error || "删除失败", { id: toastId });
      }
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("删除失败", { id: toastId });
    } finally {
      setDeleting(false);
    }
  };

  // 导出：把每个出库单展开为多行（每条 SKU 一行）
  const handleExportAll = () => {
    try {
      const exportData: Record<string, unknown>[] = [];
      for (const ob of orders) {
        if (ob.items.length === 0) {
          exportData.push({
            外部编码: ob.externalCode || "",
            收货门店: ob.storeName || "",
            收件人: ob.recipientName || "",
            电话: ob.recipientPhone || "",
            地址: ob.recipientAddress || "",
            SKU编码: "",
            SKU名称: "",
            发货数量: 0,
            规格型号: "",
            备注: ob.remark || "",
            提交时间: ob.submittedAt ? formatDate(ob.submittedAt) : "",
            状态: ob.status === "submitted" ? "已提交" : ob.status === "error" ? "有错误" : "草稿",
          });
        } else {
          for (const item of ob.items) {
            exportData.push({
              外部编码: ob.externalCode || "",
              收货门店: ob.storeName || "",
              收件人: ob.recipientName || "",
              电话: ob.recipientPhone || "",
              地址: ob.recipientAddress || "",
              SKU编码: item.skuCode,
              SKU名称: item.skuName,
              发货数量: item.skuQuantity,
              规格型号: item.skuSpec || "",
              备注: item.remark || ob.remark || "",
              提交时间: ob.submittedAt ? formatDate(ob.submittedAt) : "",
              状态: ob.status === "submitted" ? "已提交" : ob.status === "error" ? "有错误" : "草稿",
            });
          }
        }
      }
      exportToExcel(exportData, `运单列表_${new Date().toLocaleDateString()}.xlsx`);
      toast.success(`导出 ${exportData.length} 条 SKU`);
    } catch (err) {
      console.error("Export error:", err);
      toast.error("导出失败");
    }
  };

  const totalSkuCount = orders.reduce((sum, ob) => sum + ob.items.length, 0);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4 lg:space-y-5 page-container">
      {/* 吸顶操作区：标题 + 筛选 */}
      <div className="sticky top-[56px] z-30 bg-[#f7f8fa] -mx-5 lg:-mx-8 px-5 lg:px-8 pt-2 pb-3.5 space-y-3">
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb]">
          <div className="flex items-center gap-3 p-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#0fc6c2] to-[#0bada9] flex items-center justify-center text-white flex-shrink-0 shadow-[0_3px_10px_rgba(15,198,194,0.25)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-[#1d2129]">已导入运单</h1>
              <p className="text-sm text-[#86909c] mt-0.5">
                按外部编码聚合的出库单，每张单据内含全部 SKU 行
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4">
          <div className="flex flex-wrap items-center gap-2 lg:gap-2.5 search-controls-sm">
            <input
              type="text"
              placeholder="搜索外部编码..."
              value={searchExternalCode}
              onChange={(e) => setSearchExternalCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full sm:w-[180px] lg:w-[220px] px-2.5 py-1.5 text-sm border border-[#d0d7de] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20 placeholder:text-[#b5bbc3]"
            />
            <input
              type="text"
              placeholder="搜索收件人..."
              value={searchRecipientName}
              onChange={(e) => setSearchRecipientName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full sm:w-[160px] lg:w-[200px] px-2.5 py-1.5 text-sm border border-[#d0d7de] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20 placeholder:text-[#b5bbc3]"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSearch}>查询</Button>
            </div>
          </div>
        </div>
      </div>

      {/* 操作按钮行 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => (window.location.href = "/")}>
          新增
        </Button>
        {orders.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleExportAll}>
            导出（{totalSkuCount} 条 SKU）
          </Button>
        )}
      </div>

      {/* 数据列表 - 卡片式（按出库单聚合） */}
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] overflow-hidden animate-fade-in">
        {loading ? (
          <div className="p-4 lg:p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-24 rounded-lg" />
            ))}
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
            <div className="divide-y divide-[#f2f3f5]">
              {orders.map((ob) => {
                const isExpanded = expandedIds.has(ob.id);
                const totalQty = ob.items.reduce((s, i) => s + i.skuQuantity, 0);
                return (
                  <div key={ob.id} className="hover:bg-[#fafbfc] transition-colors">
                    {/* 父单头部：展开/折叠 + 共享信息 */}
                    <div
                      className="flex items-center gap-3 p-3.5 lg:p-4 cursor-pointer"
                      onClick={() => toggleExpand(ob.id)}
                    >
                      {/* 展开箭头 */}
                      <div className={`flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#86909c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                      {/* 关键信息 */}
                      <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-4 gap-2 md:gap-4">
                        <div className="min-w-0">
                          <p className="text-xs text-[#86909c]">外部编码</p>
                          <p className="text-sm font-mono font-medium text-[#1d2129] truncate">
                            {ob.externalCode || "—"}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-[#86909c]">收货门店 / 收件人</p>
                          <p className="text-sm text-[#1d2129] truncate">
                            {ob.storeName || ob.recipientName || "—"}
                          </p>
                        </div>
                        <div className="min-w-0 hidden md:block">
                          <p className="text-xs text-[#86909c]">SKU 数 / 总量</p>
                          <p className="text-sm text-[#1d2129]">
                            {ob.items.length} 项 · {totalQty}
                          </p>
                        </div>
                        <div className="min-w-0 hidden md:block">
                          <p className="text-xs text-[#86909c]">提交时间</p>
                          <p className="text-sm text-[#86909c]">
                            {ob.submittedAt ? formatDate(ob.submittedAt) : formatDate(ob.createdAt)}
                          </p>
                        </div>
                      </div>
                      {/* 状态标签 */}
                      <div className="flex-shrink-0 flex items-center gap-2">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded whitespace-nowrap ${
                            ob.status === "submitted"
                              ? "bg-[#e8fafa] text-[#0fc6c2]"
                              : ob.status === "error"
                                ? "bg-[#fff1f0] text-[#cf1322]"
                                : "bg-[#f2f3f5] text-[#86909c]"
                          }`}
                        >
                          {ob.status === "submitted"
                            ? "已提交"
                            : ob.status === "error"
                              ? "有错误"
                              : "草稿"}
                        </span>
                        {/* 删除按钮 */}
                        <button
                          onClick={(e) => handleDeleteClick(e, ob)}
                          className="flex-shrink-0 p-1 text-[#86909c] hover:text-[#cf1322] hover:bg-[#fff1f0] rounded transition-colors"
                          title="删除该运单"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* 展开后的子项：SKU 行列表 */}
                    {isExpanded && (
                      <div className="bg-[#fafbfc] border-t border-[#f2f3f5] px-4 lg:px-6 py-2">
                        {ob.items.length === 0 ? (
                          <p className="text-xs text-[#86909c] py-3 text-center">无 SKU</p>
                        ) : (
                          <div className="divide-y divide-[#f2f3f5]">
                            {/* 收货详情行 */}
                            {(ob.recipientName || ob.recipientPhone || ob.recipientAddress) && (
                              <div className="py-2 text-xs text-[#4e5969] flex flex-wrap gap-x-4 gap-y-1">
                                {ob.recipientName && <span>收件人：{ob.recipientName}</span>}
                                {ob.recipientPhone && <span>电话：{ob.recipientPhone}</span>}
                                {ob.recipientAddress && <span className="truncate max-w-[400px]">地址：{ob.recipientAddress}</span>}
                              </div>
                            )}
                            {/* SKU 表头 */}
                            <div className="grid grid-cols-12 gap-2 py-2 text-xs font-semibold text-[#86909c]">
                              <div className="col-span-1">序号</div>
                              <div className="col-span-3">SKU编码</div>
                              <div className="col-span-4">SKU名称</div>
                              <div className="col-span-2">规格</div>
                              <div className="col-span-1 text-right">数量</div>
                              <div className="col-span-1 text-right">备注</div>
                            </div>
                            {ob.items.map((item, idx) => (
                              <div key={item.id} className="grid grid-cols-12 gap-2 py-2 text-sm text-[#1d2129]">
                                <div className="col-span-1 text-[#86909c]">{idx + 1}</div>
                                <div className="col-span-3 font-mono truncate">{item.skuCode}</div>
                                <div className="col-span-4 truncate">{item.skuName}</div>
                                <div className="col-span-2 truncate text-[#4e5969]">{item.skuSpec || "—"}</div>
                                <div className="col-span-1 text-right font-medium">{item.skuQuantity}</div>
                                <div className="col-span-1 text-right text-[#86909c] truncate">{item.remark || ""}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-[#e5e6eb] bg-[#fafbfc]">
                <p className="text-sm text-[#86909c]">
                  共 {total} 张出库单
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
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 text-sm border border-[#d0d7de] rounded hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    &gt;
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 删除确认弹窗 */}
      <Modal
        isOpen={!!deletingOrder}
        onClose={() => !deleting && setDeletingOrder(null)}
        title="确认删除"
        size="sm"
      >
        {deletingOrder && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#fff1f0] text-[#cf1322] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#1d2129] leading-relaxed">
                  确定要删除该运单吗？此操作不可恢复。
                </p>
                <div className="mt-3 p-3 bg-[#fafbfc] rounded-lg border border-[#e5e6eb] text-xs text-[#4e5969] space-y-1">
                  <p>
                    <span className="text-[#86909c]">外部编码：</span>
                    <span className="font-mono font-medium text-[#1d2129]">{deletingOrder.externalCode || "—"}</span>
                  </p>
                  <p>
                    <span className="text-[#86909c]">收货门店：</span>
                    <span>{deletingOrder.storeName || "—"}</span>
                  </p>
                  <p>
                    <span className="text-[#86909c]">SKU 数：</span>
                    <span className="font-medium text-[#1d2129]">{deletingOrder.items.length} 条</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeletingOrder(null)}
                disabled={deleting}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmDelete}
                loading={deleting}
                className="!bg-[#cf1322] hover:!bg-[#a8071a] !text-white"
              >
                确认删除
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
