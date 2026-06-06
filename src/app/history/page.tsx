"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { OutboundOrder } from "@/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { StatBlock, Divider, StatusDot } from "@/components/ui/TableDecorations";
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

// 表格行描述符：每条记录对应表里的一行
type TableRow =
  | {
      kind: "sku";
      key: string;
      groupIdx: number;
      groupTotalRows: number;
      detailIdx: number;
      detailSkuCount: number;
      skuIdx: number;
      group: HistoryGroup;
      detail: OutboundOrder;
      sku: OutboundOrder["items"][number];
      isFirstRowOfGroup: boolean;
      isFirstRowOfDetail: boolean;
    }
  | {
      kind: "empty-store";
      key: string;
      groupIdx: number;
      groupTotalRows: number;
      detailIdx: number;
      detailSkuCount: 1;
      group: HistoryGroup;
      detail: OutboundOrder;
      isFirstRowOfGroup: boolean;
      isFirstRowOfDetail: true;
    }
  | {
      kind: "empty-group";
      key: string;
      groupIdx: number;
      groupTotalRows: 1;
      detailIdx: 0;
      detailSkuCount: 1;
      group: HistoryGroup;
      isFirstRowOfGroup: true;
      isFirstRowOfDetail: true;
    };

// 列定义（9 列 + # + 操作 = 11 列）
const COL_INDEX = { width: 44 };
const COL_EXTERNAL = { key: "externalCode", label: "外部编码", width: 150 };
const COL_STORE = { key: "storeName", label: "收货门店", width: 170 };
const COL_NAME = { key: "recipientName", label: "收件人", width: 100 };
const COL_PHONE = { key: "recipientPhone", label: "电话", width: 130 };
const COL_ADDR = { key: "recipientAddress", label: "地址", width: 220 };
const COL_SKU_CODE = { key: "skuCode", label: "SKU编码", width: 130 };
const COL_SKU_NAME = { key: "skuName", label: "SKU名称", width: 170 };
const COL_SKU_QTY = { key: "skuQuantity", label: "数量", width: 80 };
const COL_SKU_SPEC = { key: "skuSpec", label: "规格型号", width: 130 };
const COL_ACTION = { width: 150 };

export default function HistoryPage() {
  const [orders, setOrders] = useState<OutboundOrder[]>([]);
  const [total, setTotal] = useState(0);
  // DB 全量计数（用于"总数"/"调拨单"/"出库单" 角标）
  const [totalTransfers, setTotalTransfers] = useState(0);
  const [totalOutbounds, setTotalOutbounds] = useState(0);
  // 调拨单展开/收起状态：默认全部收起（仅显示首行）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchExternalCode, setSearchExternalCode] = useState("");
  const [searchRecipientName, setSearchRecipientName] = useState("");
  const [searchStartDate, setSearchStartDate] = useState("");
  const [searchEndDate, setSearchEndDate] = useState("");
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
      if (searchStartDate) params.set("startDate", searchStartDate);
      if (searchEndDate) params.set("endDate", searchEndDate);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const res = await fetch(`/api/orders?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        setOrders(data.data.orders);
        setTotal(data.data.total);
        setTotalTransfers(data.data.totalTransfers);
        setTotalOutbounds(data.data.totalOutbounds);
      } else {
        console.error("API error:", data.error);
        setOrders([]);
        setTotal(0);
        setTotalTransfers(0);
        setTotalOutbounds(0);
      }
    } catch (err) {
      console.error("Failed to load orders:", err);
      setOrders([]);
      setTotal(0);
      setTotalTransfers(0);
      setTotalOutbounds(0);
    } finally {
      setLoading(false);
    }
  }, [page, searchExternalCode, searchRecipientName, searchStartDate, searchEndDate]);

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

  // 把 groups 摊平成 table rows（每行 = 一个 SKU 行；空门店/空整组用占位行）
  const tableRows = useMemo<TableRow[]>(() => {
    const rows: TableRow[] = [];
    for (const [gIdx, group] of groups.entries()) {
      const totalSkuInGroup = group.details.reduce(
        (s, d) => s + d.items.length,
        0
      );

      // 空整组（极端情况）
      if (totalSkuInGroup === 0) {
        rows.push({
          kind: "empty-group",
          key: `g-${group.rootId}-empty`,
          groupIdx: gIdx,
          groupTotalRows: 1,
          detailIdx: 0,
          detailSkuCount: 1,
          group,
          isFirstRowOfGroup: true,
          isFirstRowOfDetail: true,
        });
        continue;
      }

      for (const [dIdx, detail] of group.details.entries()) {
        // 空门店（极端情况）
        if (detail.items.length === 0) {
          rows.push({
            kind: "empty-store",
            key: `s-${detail.id}-empty`,
            groupIdx: gIdx,
            groupTotalRows: totalSkuInGroup,
            detailIdx: dIdx,
            detailSkuCount: 1,
            group,
            detail,
            isFirstRowOfGroup: dIdx === 0,
            isFirstRowOfDetail: true,
          });
          continue;
        }

        for (const [sIdx, item] of detail.items.entries()) {
          rows.push({
            kind: "sku",
            key: `k-${item.id}`,
            groupIdx: gIdx,
            groupTotalRows: totalSkuInGroup,
            detailIdx: dIdx,
            detailSkuCount: detail.items.length,
            skuIdx: sIdx,
            group,
            detail,
            sku: item,
            isFirstRowOfGroup: dIdx === 0 && sIdx === 0,
            isFirstRowOfDetail: sIdx === 0,
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

  // 切换调拨单展开/收起
  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
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

  // 单元格取值
  const valueAt = (
    row: TableRow,
    key: "storeName" | "recipientName" | "recipientPhone" | "recipientAddress"
  ): string => {
    if (row.kind === "sku") {
      const v = (row.detail as unknown as Record<string, unknown>)[key];
      return v === undefined || v === null ? "" : String(v);
    }
    if (row.kind === "empty-store") {
      const v = (row.detail as unknown as Record<string, unknown>)[key];
      return v === undefined || v === null ? "" : String(v);
    }
    return "";
  };

  const skuValueAt = (
    row: TableRow,
    key: "skuCode" | "skuName" | "skuQuantity" | "skuSpec"
  ): string => {
    if (row.kind !== "sku") return "";
    const v = (row.sku as unknown as Record<string, unknown>)[key];
    return v === undefined || v === null ? "" : String(v);
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
                调拨单按 1+N+M 合并展示：1 行外部编码 + N 行门店 + M 行 SKU
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
              className="w-full sm:w-[180px] lg:w-[200px] px-2.5 py-1.5 text-sm border border-[#d0d7de] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20 placeholder:text-[#b5bbc3]"
            />
            <input
              type="text"
              placeholder="搜索收件人..."
              value={searchRecipientName}
              onChange={(e) => setSearchRecipientName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full sm:w-[150px] lg:w-[180px] px-2.5 py-1.5 text-sm border border-[#d0d7de] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20 placeholder:text-[#b5bbc3]"
            />
            <span className="text-xs text-[#86909c]">提交时间</span>
            <input
              type="date"
              value={searchStartDate}
              onChange={(e) => setSearchStartDate(e.target.value)}
              className="w-full sm:w-[140px] px-2 py-1.5 text-sm border border-[#d0d7de] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20"
            />
            <span className="text-xs text-[#86909c]">至</span>
            <input
              type="date"
              value={searchEndDate}
              onChange={(e) => setSearchEndDate(e.target.value)}
              className="w-full sm:w-[140px] px-2 py-1.5 text-sm border border-[#d0d7de] rounded-lg outline-none focus:border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20"
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
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] px-5 py-4 flex flex-wrap items-center gap-5 lg:gap-7">
        <div className="flex items-center gap-5 lg:gap-7 flex-wrap">
          <StatBlock
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <line x1="15" y1="3" x2="15" y2="21" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
              </svg>
            }
            label="总数"
            value={total}
            tone="default"
          />
          <Divider />
          <StatBlock
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h18v4H3zM3 10h18v4H3zM3 17h18v4H3z" />
              </svg>
            }
            label="当前页分组"
            value={groups.length}
            tone="default"
          />
          <Divider />
          <StatBlock
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            }
            label="SKU 总数"
            value={totalSkuCount}
            tone="primary"
          />
          <Divider />
          <StatBlock
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
                <circle cx="8" cy="6" r="1.2" fill="currentColor" />
                <circle cx="14" cy="12" r="1.2" fill="currentColor" />
                <circle cx="10" cy="18" r="1.2" fill="currentColor" />
              </svg>
            }
            label="发货总量"
            value={totalQtyCount}
            tone="primary"
          />
          {(totalTransfers > 0 || totalOutbounds > 0) && (
            <div className="hidden md:flex items-center gap-2 text-xs ml-1">
              {totalTransfers > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#e8fafa] text-[#0bada9] font-medium rounded-md border border-[#0fc6c2]/15">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0fc6c2]" />
                  调拨单 {totalTransfers}
                </span>
              )}
              {totalOutbounds > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#f2f3f5] text-[#4e5969] font-medium rounded-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#86909c]" />
                  出库单 {totalOutbounds}
                </span>
              )}
            </div>
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

      {/* 数据列表 - Excel 风格合并单元格表格 */}
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
            <div
              className="border border-[#e5e6eb] rounded-xl overflow-auto"
              style={{ maxHeight: "clamp(480px, 75vh, 760px)" }}
            >
              <table
                className="history-table min-w-max w-full text-sm"
                style={{
                  borderCollapse: "separate",
                  borderSpacing: 0,
                  minWidth: 1500,
                  tableLayout: "fixed",
                }}
              >
                <colgroup>
                  <col style={{ width: COL_INDEX.width }} />
                  <col style={{ width: COL_EXTERNAL.width }} />
                  <col style={{ width: COL_STORE.width }} />
                  <col style={{ width: COL_NAME.width }} />
                  <col style={{ width: COL_PHONE.width }} />
                  <col style={{ width: COL_ADDR.width }} />
                  <col style={{ width: COL_SKU_CODE.width }} />
                  <col style={{ width: COL_SKU_NAME.width }} />
                  <col style={{ width: COL_SKU_QTY.width }} />
                  <col style={{ width: COL_SKU_SPEC.width }} />
                  <col style={{ width: COL_ACTION.width }} />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      className="sticky top-0 left-0 z-30 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-2 py-2.5 text-[11px] font-semibold text-[#4e5969] text-center border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 tracking-wide uppercase"
                      scope="col"
                    >
                      #
                    </th>
                    <th
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] text-left border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                      scope="col"
                    >
                      {COL_EXTERNAL.label}
                    </th>
                    <th
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] text-left border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                      scope="col"
                    >
                      {COL_STORE.label}
                    </th>
                    <th
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] text-left border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                      scope="col"
                    >
                      {COL_NAME.label}
                    </th>
                    <th
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] text-left border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                      scope="col"
                    >
                      {COL_PHONE.label}
                    </th>
                    <th
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] text-left border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                      scope="col"
                    >
                      {COL_ADDR.label}
                    </th>
                    <th
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] text-left border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                      scope="col"
                    >
                      {COL_SKU_CODE.label}
                    </th>
                    <th
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] text-left border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                      scope="col"
                    >
                      {COL_SKU_NAME.label}
                    </th>
                    <th
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] text-right border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                      scope="col"
                    >
                      {COL_SKU_QTY.label}
                    </th>
                    <th
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] text-left border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                      scope="col"
                    >
                      {COL_SKU_SPEC.label}
                    </th>
                    <th
                      className="sticky top-0 right-0 z-30 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-2 py-2.5 text-[11px] font-semibold text-[#4e5969] text-center border-b-2 border-b-[#0fc6c2]/40 tracking-wide uppercase shadow-[-2px_0_4px_rgba(0,0,0,0.04)]"
                      scope="col"
                    >
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows
                    .filter((row) => expandedGroups.has(row.group.rootId) || row.isFirstRowOfGroup)
                    .map((row, rowIdx) => {
                    // 行底色
                    let rowBg: string;
                    if (row.kind === "empty-group") {
                      rowBg = "bg-[#e8fafa]/60"; // 整组空 → code 色调
                    } else if (row.kind === "empty-store") {
                      rowBg = "bg-[#f7f8fa]"; // 门店空 → store 色调
                    } else if (row.isFirstRowOfDetail) {
                      rowBg = "bg-[#f7f8fa]"; // 门店首行 → store 色调
                    } else {
                      rowBg = "bg-white"; // 后续 SKU → 白
                    }
                    // 组首行顶部青色分隔线（除表首）
                    const topBorder =
                      row.isFirstRowOfGroup && rowIdx > 0
                        ? "border-t-2 border-t-[#0fc6c2]/30"
                        : "";

                    const isCollapsed = !expandedGroups.has(row.group.rootId);
                    return (
                      <tr
                        key={row.key}
                        className={cn(
                          "group transition-colors",
                          topBorder,
                          isCollapsed && row.isFirstRowOfGroup && "is-collapsed"
                        )}
                        onClick={isCollapsed && row.isFirstRowOfGroup ? () => toggleGroup(row.group.rootId) : undefined}
                      >
                        {/* # 列 - 跨整组 */}
                        {row.isFirstRowOfGroup && (
                          <td
                            rowSpan={row.groupTotalRows}
                            className={cn(
                              "sticky left-0 z-10 px-2 py-2.5 text-[11px] text-center border-r border-b border-[#f2f3f5] font-mono align-top",
                              "bg-inherit",
                              "text-[#0fc6c2] font-semibold"
                            )}
                            style={{
                              backgroundColor:
                                row.kind === "empty-group"
                                  ? "rgba(232, 250, 250, 0.6)"
                                  : row.kind === "empty-store"
                                    ? "#f7f8fa"
                                    : row.isFirstRowOfDetail
                                      ? "#f7f8fa"
                                      : "#ffffff",
                            }}
                          >
                            {row.groupIdx + 1}
                          </td>
                        )}

                        {/* 外部编码列 - 跨整组（运单号 + 摘要徽章） */}
                        {row.isFirstRowOfGroup && (
                          <td
                            rowSpan={row.groupTotalRows}
                            className="px-3 py-2.5 border-r border-b border-[#f2f3f5] align-top"
                            style={{
                              backgroundColor:
                                row.kind === "empty-group"
                                  ? "rgba(232, 250, 250, 0.6)"
                                  : row.kind === "empty-store"
                                    ? "#f7f8fa"
                                    : row.isFirstRowOfDetail
                                      ? "#f7f8fa"
                                      : "#ffffff",
                            }}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <StatusDot status={row.group.status} />
                              {isCollapsed && row.group.totalSku > 1 && (
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="#0fc6c2"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="shrink-0"
                                >
                                  <polyline points="9 6 15 12 9 18" />
                                </svg>
                              )}
                              <span
                                className="block truncate font-mono font-semibold text-[#1d2129]"
                                title={row.group.externalCode}
                              >
                                {row.group.externalCode || "—"}
                              </span>
                              {isCollapsed && row.group.totalSku > 1 && (
                                <span
                                  className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-[#0bada9] bg-white border border-[#0fc6c2]/30 rounded"
                                  title={`包含 ${row.group.details.length} 个门店 / ${row.group.totalSku} 条 SKU`}
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="2" />
                                    <line x1="9" y1="3" x2="9" y2="21" />
                                    <line x1="15" y1="3" x2="15" y2="21" />
                                    <line x1="3" y1="9" x2="21" y2="9" />
                                    <line x1="3" y1="15" x2="21" y2="15" />
                                  </svg>
                                  {row.group.details.length} 门店 · {row.group.totalSku} SKU
                                </span>
                              )}
                            </div>
                          </td>
                        )}

                        {/* 门店信息 4 列 - 跨该门店的 SKU 行 */}
                        {row.isFirstRowOfDetail && (
                          <>
                            <td
                              rowSpan={row.detailSkuCount}
                              className="px-3 py-2.5 text-sm border-r border-b border-[#f2f3f5] align-top"
                              style={{
                                backgroundColor:
                                  row.kind === "empty-store"
                                    ? "#f7f8fa"
                                    : "#f7f8fa",
                              }}
                            >
                              <span
                                className={cn(
                                  "block truncate",
                                  !valueAt(row, "storeName") &&
                                    "text-[#c9cdd4] italic"
                                )}
                                title={valueAt(row, "storeName")}
                              >
                                {valueAt(row, "storeName") || "—"}
                              </span>
                            </td>
                            <td
                              rowSpan={row.detailSkuCount}
                              className="px-3 py-2.5 text-sm border-r border-b border-[#f2f3f5] align-top"
                              style={{ backgroundColor: "#f7f8fa" }}
                            >
                              <span
                                className={cn(
                                  "block truncate",
                                  !valueAt(row, "recipientName") &&
                                    "text-[#c9cdd4] italic"
                                )}
                                title={valueAt(row, "recipientName")}
                              >
                                {valueAt(row, "recipientName") || "—"}
                              </span>
                            </td>
                            <td
                              rowSpan={row.detailSkuCount}
                              className="px-3 py-2.5 text-sm border-r border-b border-[#f2f3f5] align-top font-mono"
                              style={{ backgroundColor: "#f7f8fa" }}
                            >
                              <span
                                className={cn(
                                  "block truncate",
                                  !valueAt(row, "recipientPhone") &&
                                    "text-[#c9cdd4] italic"
                                )}
                                title={valueAt(row, "recipientPhone")}
                              >
                                {valueAt(row, "recipientPhone") || "—"}
                              </span>
                            </td>
                            <td
                              rowSpan={row.detailSkuCount}
                              className="px-3 py-2.5 text-sm border-r border-b border-[#f2f3f5] align-top"
                              style={{ backgroundColor: "#f7f8fa" }}
                            >
                              <span
                                className={cn(
                                  "block truncate",
                                  !valueAt(row, "recipientAddress") &&
                                    "text-[#c9cdd4] italic"
                                )}
                                title={valueAt(row, "recipientAddress")}
                              >
                                {valueAt(row, "recipientAddress") || "—"}
                              </span>
                            </td>
                          </>
                        )}

                        {/* SKU 4 列 - 每行独立 */}
                        <td
                          className={cn(
                            "px-3 py-2.5 text-sm border-r border-b border-[#f2f3f5] font-mono",
                            rowBg,
                            row.kind === "empty-group" && "italic text-[#c9cdd4]"
                          )}
                        >
                          <span
                            className={cn(
                              "block truncate",
                              !skuValueAt(row, "skuCode") &&
                                "text-[#c9cdd4] italic"
                            )}
                            title={skuValueAt(row, "skuCode")}
                          >
                            {skuValueAt(row, "skuCode") || "—"}
                          </span>
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-sm border-r border-b border-[#f2f3f5]",
                            rowBg,
                            row.kind === "empty-group" && "italic text-[#c9cdd4]"
                          )}
                        >
                          <span
                            className={cn(
                              "block truncate",
                              !skuValueAt(row, "skuName") &&
                                "text-[#c9cdd4] italic"
                            )}
                            title={skuValueAt(row, "skuName")}
                          >
                            {skuValueAt(row, "skuName") || "—"}
                          </span>
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-sm text-right border-r border-b border-[#f2f3f5] tabular-nums",
                            rowBg,
                            row.kind === "empty-group" && "italic text-[#c9cdd4]"
                          )}
                        >
                          <span
                            className={cn(
                              "block truncate",
                              !skuValueAt(row, "skuQuantity") &&
                                "text-[#c9cdd4] italic"
                            )}
                            title={skuValueAt(row, "skuQuantity")}
                          >
                            {skuValueAt(row, "skuQuantity") || "—"}
                          </span>
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-sm border-r border-b border-[#f2f3f5]",
                            rowBg,
                            row.kind === "empty-group" && "italic text-[#c9cdd4]"
                          )}
                        >
                          <span
                            className={cn(
                              "block truncate",
                              !skuValueAt(row, "skuSpec") &&
                                "text-[#c9cdd4] italic"
                            )}
                            title={skuValueAt(row, "skuSpec")}
                          >
                            {skuValueAt(row, "skuSpec") || "—"}
                          </span>
                        </td>

                        {/* 操作列 - 跨整组（chevron 展开/收起 + 删除） */}
                        {row.isFirstRowOfGroup && (
                          <td
                            rowSpan={row.groupTotalRows}
                            className={cn(
                              "sticky right-0 z-10 px-2.5 py-2.5 text-sm border-b border-[#f2f3f5] align-top shadow-[-2px_0_4px_rgba(0,0,0,0.04)]",
                              !isCollapsed && "bg-white"
                            )}
                            style={
                              isCollapsed
                                ? undefined
                                : {
                                    backgroundColor:
                                      row.kind === "empty-group"
                                        ? "rgba(232, 250, 250, 0.6)"
                                        : row.kind === "empty-store"
                                          ? "#f7f8fa"
                                          : row.isFirstRowOfDetail
                                            ? "#f7f8fa"
                                            : "#ffffff",
                                  }
                            }
                          >
                            <div
                              className="flex items-center justify-end gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isCollapsed ? (
                                <button
                                  onClick={() => toggleGroup(row.group.rootId)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-br from-[#0fc6c2] to-[#0bada9] hover:from-[#0bada9] hover:to-[#098f8b] rounded-md shadow-[0_2px_6px_rgba(15,198,194,0.3)] transition-all whitespace-nowrap"
                                  title={`展开 ${row.group.details.length} 个门店 / ${row.group.totalSku} 条 SKU`}
                                >
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="6 9 12 15 18 9" />
                                  </svg>
                                  展开
                                </button>
                              ) : (
                                <button
                                  onClick={() => toggleGroup(row.group.rootId)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#86909c] hover:text-[#0fc6c2] hover:bg-[#e8fafa] rounded transition-colors whitespace-nowrap"
                                  title="收起详情"
                                >
                                  <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="6 9 12 15 18 9" />
                                  </svg>
                                  收起
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteClick(row.group)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#86909c] hover:text-[#cf1322] hover:bg-[#fff1f0] rounded transition-colors whitespace-nowrap"
                                title={
                                  row.group.kind === "transfer"
                                    ? "删除整张调拨单"
                                    : "删除该运单"
                                }
                              >
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                  <path d="M10 11v6" />
                                  <path d="M14 11v6" />
                                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                </svg>
                                删除
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#e5e6eb] bg-[#fafbfc]">
              <p className="text-sm text-[#86909c]">
                共 {total} 张出库单，{totalSkuCount} 条 SKU
              </p>
              {totalPages > 1 && (
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
              )}
            </div>
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
