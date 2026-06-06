"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { OutboundOrder } from "@/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { formatDate, exportToExcel, cn } from "@/lib/utils";

// 历史组：1 调拨单 = 1 个 transfer 模式的 group，1 父出库单 = 1 个 outbound 模式的 group
type HistoryGroup = {
  kind: "transfer" | "outbound";
  externalCode: string;
  // 顶层 ID（删除用）：transfer 模式是 transferOrderId，outbound 模式是首个 outbound_order.id
  rootId: string;
  // 全部明细 OutboundOrder（transfer 模式有 N 个，outbound 模式只有 1 个）
  details: OutboundOrder[];
  // 全部 SKU 行（扁平）
  totalQty: number;
  totalSku: number;
  submittedAt?: string;
  createdAt: string;
  status: "draft" | "submitted" | "error";
};

const columns: Array<{ key: string; label: string; width: number }> = [
  { key: "externalCode", label: "外部编码", width: 130 },
  { key: "storeName", label: "收货门店", width: 160 },
  { key: "recipientName", label: "收件人", width: 100 },
  { key: "recipientPhone", label: "电话", width: 130 },
  { key: "recipientAddress", label: "地址", width: 200 },
  { key: "skuCode", label: "SKU编码", width: 120 },
  { key: "skuName", label: "SKU名称", width: 150 },
  { key: "skuQuantity", label: "数量", width: 80 },
  { key: "skuSpec", label: "规格型号", width: 120 },
];

export default function HistoryPage() {
  const [orders, setOrders] = useState<OutboundOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchExternalCode, setSearchExternalCode] = useState("");
  const [searchRecipientName, setSearchRecipientName] = useState("");
  // 待删除的分组
  const [deletingGroup, setDeletingGroup] = useState<HistoryGroup | null>(null);
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

  // 把 OutboundOrder[] 聚合成 HistoryGroup[]
  // - transfer 模式：按 transferOrderId 聚合（同一调拨单的多门店归到一组）
  // - outbound 模式（无 transferOrderId）：每个 OutboundOrder 自成一组
  const groups = useMemo<HistoryGroup[]>(() => {
    const groups: HistoryGroup[] = [];
    const transferMap = new Map<string, HistoryGroup>();

    for (const ob of orders) {
      if (ob.transferOrderId) {
        // 调拨单模式：按 transferOrderId 聚合
        let g = transferMap.get(ob.transferOrderId);
        if (!g) {
          g = {
            kind: "transfer",
            externalCode: ob.externalCode || "（无编码）",
            rootId: ob.transferOrderId,
            details: [],
            totalQty: 0,
            totalSku: 0,
            submittedAt: ob.submittedAt,
            createdAt: ob.createdAt,
            status: ob.status,
          };
          transferMap.set(ob.transferOrderId, g);
          groups.push(g);
        }
        g.details.push(ob);
        g.totalQty += ob.items.reduce((s, i) => s + (i.skuQuantity || 0), 0);
        g.totalSku += ob.items.length;
        // 取最新提交时间
        if (ob.submittedAt && (!g.submittedAt || ob.submittedAt > g.submittedAt)) {
          g.submittedAt = ob.submittedAt;
        }
      } else {
        // 出库单模式：每个 OutboundOrder 自成一组
        groups.push({
          kind: "outbound",
          externalCode: ob.externalCode || "（无编码）",
          rootId: ob.id,
          details: [ob],
          totalQty: ob.items.reduce((s, i) => s + (i.skuQuantity || 0), 0),
          totalSku: ob.items.length,
          submittedAt: ob.submittedAt,
          createdAt: ob.createdAt,
          status: ob.status,
        });
      }
    }
    return groups;
  }, [orders]);

  // 扁平行：1 group = 1 code row + N store rows + M SKU rows
  type FlatRow =
    | { kind: "code"; key: string; group: HistoryGroup; groupIdx: number }
    | { kind: "store"; key: string; group: HistoryGroup; detail: OutboundOrder; groupIdx: number; storeIdx: number }
    | { kind: "sku"; key: string; group: HistoryGroup; detail: OutboundOrder; item: OutboundOrder["items"][number]; groupIdx: number; skuIdx: number };

  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const [gIdx, group] of groups.entries()) {
      rows.push({ kind: "code", key: `c-${group.rootId}`, group, groupIdx: gIdx });
      for (const [dIdx, detail] of group.details.entries()) {
        rows.push({
          kind: "store",
          key: `s-${detail.id}`,
          group,
          detail,
          groupIdx: gIdx,
          storeIdx: dIdx,
        });
      }
      let sIdx = 0;
      for (const detail of group.details) {
        for (const item of detail.items) {
          rows.push({
            kind: "sku",
            key: `k-${item.id}`,
            group,
            detail,
            item,
            groupIdx: gIdx,
            skuIdx: sIdx++,
          });
        }
      }
    }
    return rows;
  }, [groups]);

  // 触发删除（弹出确认）
  const handleDeleteClick = (group: HistoryGroup) => {
    setDeletingGroup(group);
  };

  // 确认删除
  const handleConfirmDelete = async () => {
    if (!deletingGroup) return;
    setDeleting(true);
    const toastId = toast.loading("正在删除...");
    try {
      let url: string;
      if (deletingGroup.kind === "transfer") {
        url = `/api/transfer-orders/${encodeURIComponent(deletingGroup.rootId)}`;
      } else {
        url = `/api/orders/${encodeURIComponent(deletingGroup.rootId)}`;
      }
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success(
          deletingGroup.kind === "transfer" ? "已删除整张调拨单" : "已删除",
          { id: toastId }
        );
        setDeletingGroup(null);
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

  // 导出：按行展开（1 调拨单 = 1+N+M 行）
  const handleExportAll = () => {
    try {
      const exportData: Record<string, unknown>[] = [];
      for (const group of groups) {
        for (const detail of group.details) {
          if (detail.items.length === 0) {
            exportData.push({
              外部编码: group.externalCode,
              收货门店: detail.storeName || "",
              收件人: detail.recipientName || "",
              电话: detail.recipientPhone || "",
              地址: detail.recipientAddress || "",
              SKU编码: "",
              SKU名称: "",
              发货数量: 0,
              规格型号: "",
              备注: detail.remark || "",
              提交时间: group.submittedAt ? formatDate(group.submittedAt) : "",
              状态:
                group.status === "submitted"
                  ? "已提交"
                  : group.status === "error"
                    ? "有错误"
                    : "草稿",
            });
          } else {
            for (const item of detail.items) {
              exportData.push({
                外部编码: group.externalCode,
                收货门店: detail.storeName || "",
                收件人: detail.recipientName || "",
                电话: detail.recipientPhone || "",
                地址: detail.recipientAddress || "",
                SKU编码: item.skuCode,
                SKU名称: item.skuName,
                发货数量: item.skuQuantity,
                规格型号: item.skuSpec || "",
                备注: item.remark || detail.remark || "",
                提交时间: group.submittedAt ? formatDate(group.submittedAt) : "",
                状态:
                  group.status === "submitted"
                    ? "已提交"
                    : group.status === "error"
                      ? "有错误"
                      : "草稿",
              });
            }
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

  const totalSkuCount = groups.reduce((sum, g) => sum + g.totalSku, 0);
  const totalQtyCount = groups.reduce((sum, g) => sum + g.totalQty, 0);
  const totalPages = Math.ceil(total / pageSize);
  const transferCount = groups.filter((g) => g.kind === "transfer").length;
  const outboundCount = groups.filter((g) => g.kind === "outbound").length;

  // 取值：单元格当前展示值
  const valueForCell = (row: FlatRow, key: string): string => {
    let v: unknown = "";
    if (row.kind === "code") {
      if (key === "externalCode") v = row.group.externalCode;
    } else if (row.kind === "store") {
      v = (row.detail as unknown as Record<string, unknown>)[key];
    } else {
      v = (row.item as unknown as Record<string, unknown>)[key];
    }
    return v === undefined || v === null ? "" : String(v);
  };

  const cellApplicable = (row: FlatRow, key: string): boolean => {
    if (row.kind === "code") return key === "externalCode";
    if (row.kind === "store") {
      return [
        "storeName",
        "recipientName",
        "recipientPhone",
        "recipientAddress",
      ].includes(key);
    }
    return ["skuCode", "skuName", "skuQuantity", "skuSpec"].includes(key);
  };

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
                调拨单按 1+N+M 扁平展示：1 行外部编码 + N 行门店 + M 行 SKU
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
              <Button size="sm" onClick={handleSearch}>
                查询
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 统计 + 操作按钮行 */}
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] p-4 lg:p-4.5 flex flex-wrap items-center gap-4 lg:gap-6">
        <div className="flex items-center gap-4 lg:gap-6 flex-wrap">
          <div>
            <p className="text-xs text-[#86909c] mb-0.5">总数</p>
            <p className="text-xl font-semibold text-[#1d2129]">{total}</p>
          </div>
          <div className="w-[1px] h-9 bg-[#e5e6eb] hidden sm:block" />
          <div>
            <p className="text-xs text-[#86909c] mb-0.5">当前页分组</p>
            <p className="text-xl font-semibold text-[#1d2129]">{groups.length}</p>
          </div>
          <div className="w-[1px] h-9 bg-[#e5e6eb] hidden sm:block" />
          <div>
            <p className="text-xs text-[#86909c] mb-0.5">SKU 总数</p>
            <p className="text-xl font-semibold text-[#0fc6c2]">{totalSkuCount}</p>
          </div>
          <div className="w-[1px] h-9 bg-[#e5e6eb] hidden sm:block" />
          <div>
            <p className="text-xs text-[#86909c] mb-0.5">发货总量</p>
            <p className="text-xl font-semibold text-[#0fc6c2]">{totalQtyCount}</p>
          </div>
          {(transferCount > 0 || outboundCount > 0) && (
            <>
              <div className="w-[1px] h-9 bg-[#e5e6eb] hidden md:block" />
              <div className="hidden md:flex items-center gap-2 text-xs">
                {transferCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#e8fafa] text-[#0fc6c2] rounded">
                    调拨单 {transferCount}
                  </span>
                )}
                {outboundCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#f2f3f5] text-[#86909c] rounded">
                    出库单 {outboundCount}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Button size="sm" onClick={() => (window.location.href = "/")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            新增
          </Button>
          {orders.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExportAll}>
              导出（{totalSkuCount} 条 SKU）
            </Button>
          )}
        </div>
      </div>

      {/* 数据列表 - 扁平表格 */}
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] overflow-hidden animate-fade-in">
        {loading ? (
          <div className="p-4 lg:p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-12 rounded-lg" />
            ))}
          </div>
        ) : groups.length === 0 ? (
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
            <div className="border border-[#e5e6eb] rounded-xl overflow-auto" style={{ maxHeight: "clamp(480px, 75vh, 760px)" }}>
              {/* 表头 - 吸顶 */}
              <div className="sticky top-0 z-10 flex bg-[#fafbfc] border-b border-[#e5e6eb] min-w-max shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                <div className="flex-shrink-0 w-10 lg:w-12 px-1 lg:px-2 py-2.5 text-xs font-semibold text-[#4e5969] text-center border-r border-[#e5e6eb] sticky left-0 bg-[#fafbfc] z-20">
                  #
                </div>
                {columns.map((col) => (
                  <div
                    key={col.key}
                    className="flex-shrink-0 px-2.5 lg:px-3 py-2.5 text-xs font-semibold text-[#4e5969] border-r border-[#e5e6eb] whitespace-nowrap"
                    style={{ width: col.width }}
                  >
                    {col.label}
                  </div>
                ))}
                <div className="flex-shrink-0 w-14 lg:w-16 px-2 py-2.5 text-xs font-semibold text-[#4e5969] text-center sticky right-0 bg-[#fafbfc] z-20 shadow-[-2px_0_4px_rgba(0,0,0,0.04)]">
                  操作
                </div>
              </div>

              {/* 行 */}
              <div className="min-w-max">
                {flatRows.map((row, rowIdx) => {
                  const isCode = row.kind === "code";
                  const isStore = row.kind === "store";

                  // 行底色（区分行类型 + 分组首行加顶部边框）
                  const bgClass = isCode
                    ? "bg-[#e8fafa]/60"
                    : isStore
                      ? "bg-[#f7f8fa]"
                      : "bg-white";
                  const groupTopBorder =
                    isCode && rowIdx > 0 ? "border-t-2 border-t-[#0fc6c2]/30" : "";

                  // 当前行序号显示
                  const rowLabel = isCode
                    ? `${row.groupIdx + 1}`
                    : isStore
                      ? `${row.groupIdx + 1}.${row.storeIdx + 1}`
                      : `${row.groupIdx + 1}.S${row.skuIdx + 1}`;

                  return (
                    <div
                      key={row.key}
                      className={cn(
                        "flex border-b border-[#f2f3f5] min-w-max hover:bg-[#fafbfc]/60 transition-colors",
                        bgClass,
                        groupTopBorder
                      )}
                    >
                      {/* 行号 - 粘性左列 */}
                      <div
                        className={cn(
                          "flex-shrink-0 w-10 lg:w-12 px-1 lg:px-2 py-2.5 text-[11px] text-center border-r border-[#f2f3f5] sticky left-0 z-10 bg-inherit font-mono",
                          isCode
                            ? "text-[#0fc6c2] font-semibold"
                            : "text-[#86909c]"
                        )}
                      >
                        {rowLabel}
                      </div>

                      {/* 数据列 */}
                      {columns.map((col) => {
                        const applicable = cellApplicable(row, col.key);
                        if (!applicable) {
                          return (
                            <div
                              key={col.key}
                              className="flex-shrink-0 px-2.5 lg:px-3 py-2.5 border-r border-[#f2f3f5]"
                              style={{ width: col.width }}
                            />
                          );
                        }

                        const displayValue = valueForCell(row, col.key);

                        return (
                          <div
                            key={col.key}
                            className="flex-shrink-0 px-2.5 lg:px-3 py-2.5 text-sm border-r border-[#f2f3f5] relative"
                            style={{ width: col.width }}
                          >
                            {isCode ? (
                              <div className="flex flex-col gap-1.5 min-w-0">
                                <span
                                  className="block truncate font-mono font-semibold text-[#1d2129]"
                                  title={displayValue}
                                >
                                  {displayValue || "—"}
                                </span>
                                {/* code 行附加信息：状态 + 提交时间 + 模式 + 总数 */}
                                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                  <span
                                    className={cn(
                                      "inline-block px-1.5 py-0 rounded whitespace-nowrap",
                                      row.group.kind === "transfer"
                                        ? "bg-[#fff7e8] text-[#d97b00]"
                                        : "bg-[#f2f3f5] text-[#86909c]"
                                    )}
                                  >
                                    {row.group.kind === "transfer" ? "调拨单" : "出库单"}
                                  </span>
                                  <span
                                    className={cn(
                                      "inline-block px-1.5 py-0 rounded whitespace-nowrap",
                                      row.group.status === "submitted"
                                        ? "bg-[#e8fafa] text-[#0fc6c2]"
                                        : row.group.status === "error"
                                          ? "bg-[#fff1f0] text-[#cf1322]"
                                          : "bg-[#f2f3f5] text-[#86909c]"
                                    )}
                                  >
                                    {row.group.status === "submitted"
                                      ? "已提交"
                                      : row.group.status === "error"
                                        ? "有错误"
                                        : "草稿"}
                                  </span>
                                  <span className="text-[#86909c] whitespace-nowrap">
                                    {row.group.submittedAt
                                      ? formatDate(row.group.submittedAt)
                                      : formatDate(row.group.createdAt)}
                                  </span>
                                </div>
                                <div className="text-[11px] text-[#86909c] whitespace-nowrap">
                                  {row.group.details.length} 个调拨明细 ·{" "}
                                  {row.group.totalSku} 条 SKU · 总量{" "}
                                  {row.group.totalQty}
                                </div>
                              </div>
                            ) : (
                              <span
                                className={cn(
                                  "block truncate",
                                  !displayValue && "text-[#c9cdd4] italic"
                                )}
                                title={displayValue}
                              >
                                {displayValue || "—"}
                              </span>
                            )}
                          </div>
                        );
                      })}

                      {/* 操作列 - 粘性右列 */}
                      <div className="flex-shrink-0 w-14 lg:w-16 px-2 py-2.5 flex items-center justify-center sticky right-0 z-10 bg-inherit shadow-[-2px_0_4px_rgba(0,0,0,0.04)]">
                        {isCode && (
                          <button
                            onClick={() => handleDeleteClick(row.group)}
                            className="px-2 py-1 text-xs text-[#86909c] hover:text-[#cf1322] hover:bg-[#fff1f0] rounded transition-colors whitespace-nowrap"
                            title={
                              row.group.kind === "transfer"
                                ? "删除整张调拨单"
                                : "删除该运单"
                            }
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
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
        isOpen={!!deletingGroup}
        onClose={() => !deleting && setDeletingGroup(null)}
        title="确认删除"
        size="sm"
      >
        {deletingGroup && (
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
                  {deletingGroup.kind === "transfer"
                    ? "确定要删除整张调拨单吗？此操作不可恢复。"
                    : "确定要删除该运单吗？此操作不可恢复。"}
                </p>
                <div className="mt-3 p-3 bg-[#fafbfc] rounded-lg border border-[#e5e6eb] text-xs text-[#4e5969] space-y-1.5">
                  <p className="flex items-center gap-2 flex-wrap">
                    <span className="text-[#86909c]">类型：</span>
                    <span
                      className={cn(
                        "inline-block px-1.5 py-0 rounded",
                        deletingGroup.kind === "transfer"
                          ? "bg-[#fff7e8] text-[#d97b00]"
                          : "bg-[#f2f3f5] text-[#86909c]"
                      )}
                    >
                      {deletingGroup.kind === "transfer" ? "调拨单" : "出库单"}
                    </span>
                  </p>
                  <p>
                    <span className="text-[#86909c]">外部编码：</span>
                    <span className="font-mono font-medium text-[#1d2129]">
                      {deletingGroup.externalCode}
                    </span>
                  </p>
                  <p>
                    <span className="text-[#86909c]">调拨明细：</span>
                    <span className="font-medium text-[#1d2129]">
                      {deletingGroup.details.length} 个
                    </span>
                  </p>
                  <p>
                    <span className="text-[#86909c]">SKU 数：</span>
                    <span className="font-medium text-[#1d2129]">
                      {deletingGroup.totalSku} 条
                    </span>
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeletingGroup(null)}
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
