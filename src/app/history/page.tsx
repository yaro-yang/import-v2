"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";

interface OrderItem {
  id: string;
  skuCode: string;
  skuName: string;
  skuQuantity: number;
  skuSpec?: string;
}

interface Order {
  id: string;
  externalCode?: string;
  storeName?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  remark?: string;
  status: string;
  sourceFile?: string;
  sourceRow?: number;
  batchId?: string;
  createdAt: string;
  submittedAt?: string;
  transferOrderId?: string;
  items: OrderItem[];
}

interface Group {
  id: string;
  externalCode: string;
  orders: Order[];
  totalQty: number;
  totalSku: number;
  status: string;
  createdAt: string;
}

export default function HistoryPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchCode, setSearchCode] = useState("");
  const [searchName, setSearchName] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const pageSize = 50;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (searchCode) params.set("externalCode", searchCode);
      if (searchName) params.set("recipientName", searchName);
      const res = await fetch(`/api/orders?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = data.data?.orders || data.orders || [];
      setOrders(list);
      setTotal(data.data?.total || data.total || list.length);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [page, searchCode, searchName]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const o of orders) {
      const key = o.transferOrderId || o.batchId || o.id;
      let g = map.get(key);
      if (!g) {
        g = {
          id: key,
          externalCode: o.externalCode || "—",
          orders: [],
          totalQty: 0,
          totalSku: 0,
          status: o.status,
          createdAt: o.createdAt,
        };
        map.set(key, g);
      }
      g.orders.push(o);
      const safeItems = Array.isArray(o.items) ? o.items : [];
      g.totalQty += safeItems.reduce((s, i) => s + (Number(i.skuQuantity) || 0), 0);
      g.totalSku += safeItems.length;
    }
    return Array.from(map.values());
  }, [orders]);

  const totalPages = Math.ceil(total / pageSize);
  const totalSku = groups.reduce((s, g) => s + g.totalSku, 0);
  const totalQty = groups.reduce((s, g) => s + g.totalQty, 0);

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedGroups.size === groups.length) {
      setSelectedGroups(new Set());
    } else {
      setSelectedGroups(new Set(groups.map(g => g.id)));
    }
  };

  const handleDelete = async (groupId: string) => {
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    if (!confirm(`确定要删除「${g.externalCode}」及其 ${g.orders.length} 条明细吗？`)) return;
    let ok = 0;
    for (const o of g.orders) {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(o.id)}`, { method: "DELETE" });
        const d = await res.json();
        if (d.success) ok++;
      } catch { /* ignore */ }
    }
    loadOrders();
  };

  const handleBatchDelete = async () => {
    if (selectedGroups.size === 0) return;
    if (!confirm(`确定要删除 ${selectedGroups.size} 个分组吗？`)) return;
    for (const id of selectedGroups) await handleDelete(id);
    setSelectedGroups(new Set());
  };

  const handleExport = () => {
    const rows: Record<string, unknown>[] = [];
    for (const g of groups) {
      for (const o of g.orders) {
        const safeItems = Array.isArray(o.items) ? o.items : [];
        if (safeItems.length === 0) {
          rows.push({
            外部编码: g.externalCode,
            收货门店: o.storeName || "",
            收件人: o.recipientName || "",
            电话: o.recipientPhone || "",
            地址: o.recipientAddress || "",
            SKU编码: "", SKU名称: "", 数量: 0, 规格: "", 备注: o.remark || "",
          });
        } else {
          for (const item of safeItems) {
            rows.push({
              外部编码: g.externalCode,
              收货门店: o.storeName || "",
              收件人: o.recipientName || "",
              电话: o.recipientPhone || "",
              地址: o.recipientAddress || "",
              SKU编码: item.skuCode || "",
              SKU名称: item.skuName || "",
              数量: item.skuQuantity || 0,
              规格: item.skuSpec || "",
              备注: o.remark || "",
            });
          }
        }
      }
    }
    // 简单的 CSV 导出
    const header = Object.keys(rows[0] || {}).join(",");
    const csv = [header, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `运单导出_${new Date().toLocaleDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="p-20 text-center">
        <p className="text-gray-500 text-lg mb-2">加载失败</p>
        <p className="text-gray-400 text-sm mb-4">{error}</p>
        <button onClick={loadOrders} className="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm hover:bg-teal-600 transition-colors">重试</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">已导入运单</h1>
          <p className="text-sm text-gray-500 mt-1">查看和管理已导入的运单数据</p>
        </div>
        <div className="flex items-center gap-3">
          {groups.length > 0 && (
            <button onClick={handleExport} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-all shadow-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              导出 CSV
            </button>
          )}
          <Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 rounded-xl hover:from-teal-600 hover:to-cyan-600 transition-all shadow-md shadow-teal-500/25">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            导入运单
          </Link>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "总运单数", value: total.toLocaleString(), icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", color: "text-teal-500", bg: "bg-teal-50" },
          { label: "当前页分组", value: groups.length.toLocaleString(), icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10", color: "text-blue-500", bg: "bg-blue-50" },
          { label: "SKU 总数", value: totalSku.toLocaleString(), icon: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z", color: "text-emerald-500", bg: "bg-emerald-50" },
          { label: "发货总量", value: totalQty.toLocaleString(), icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6", color: "text-amber-500", bg: "bg-amber-50" },
        ].map((card, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{card.label}</span>
              <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center`}>
                <svg className={`w-4 h-4 ${card.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={card.icon} /></svg>
              </div>
            </div>
            <div className={`text-2xl font-bold ${card.color} tabular-nums`}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* 搜索 + 操作栏 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative"><svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg><input type="text" placeholder="搜索外部编码..." value={searchCode} onChange={e => setSearchCode(e.target.value)}
            onKeyDown={e => e.key === "Enter" && (setPage(1), loadOrders())}
            className="pl-10 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 w-52 placeholder:text-gray-300" /></div>
          <div className="relative"><svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg><input type="text" placeholder="搜索收件人..." value={searchName} onChange={e => setSearchName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && (setPage(1), loadOrders())}
            className="pl-10 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 w-52 placeholder:text-gray-300" /></div>
          <button onClick={() => { setPage(1); loadOrders(); }} className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 rounded-xl hover:from-teal-600 hover:to-cyan-600 transition-all shadow-md shadow-teal-500/25"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>查询</button>
          {selectedGroups.size > 0 && (
            <button onClick={handleBatchDelete} className="ml-auto px-4 py-2 text-sm font-medium text-white bg-rose-500 rounded-xl hover:bg-rose-600 transition-colors">
              删除选中 ({selectedGroups.size})
            </button>
          )}
        </div>
      </div>

      {/* 数据列表 */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-10 space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : groups.length === 0 ? (
          <div className="p-20 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
            </div>
            <p className="text-gray-400 text-sm">暂无运单数据</p>
            <Link href="/" className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-teal-500 hover:text-teal-600">上传文件导入运单</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="py-4 px-5 w-10">
                    <input type="checkbox" checked={groups.length > 0 && selectedGroups.size === groups.length}
                      onChange={selectAll} className="accent-teal-500 w-3.5 h-3.5" />
                  </th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-32">外部编码</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-32">收货门店</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-24">收件人</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-32">电话</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-32">SKU编码</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-40">SKU名称</th>
                  <th className="text-right py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-28">数量</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-28">状态</th>
                  <th className="text-right py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-32">时间</th>
                  <th className="text-center py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider w-28">操作</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const isExpanded = expandedGroups.has(group.id);
                  const rows: Array<{ order: Order; item?: OrderItem }> = [];
                  for (const o of group.orders) {
                    const safeItems = Array.isArray(o.items) ? o.items : [];
                    if (safeItems.length === 0) rows.push({ order: o });
                    else for (const item of safeItems) rows.push({ order: o, item });
                  }
                  const showRows = isExpanded ? rows : rows.slice(0, 1);

                  return showRows.map((row, idx) => {
                    const isFirst = idx === 0;
                    const o = row.order;
                    const item = row.item;
                    return (
                      <tr key={`${group.id}-${idx}`} className="border-b border-gray-50 hover:bg-gray-50/30 transition-colors">
                        {isFirst && (
                          <>
                            <td rowSpan={showRows.length} className="py-4 px-5 align-top">
                              <input type="checkbox" checked={selectedGroups.has(group.id)}
                                onChange={() => toggleSelect(group.id)} className="accent-teal-500 w-3.5 h-3.5" />
                            </td>
                            <td rowSpan={showRows.length} className="py-4 px-5 align-top">
                              <div className="font-mono text-xs font-semibold text-gray-700">{group.externalCode}</div>
                              {rows.length > 1 && (
                                <button onClick={() => toggleGroup(group.id)}
                                  className="text-xs text-teal-500 hover:text-teal-600 mt-1 font-medium">
                                  {isExpanded ? "收起" : `展开全部 ${rows.length} 行`}
                                </button>
                              )}
                            </td>
                          </>
                        )}
                        <td className="py-3 px-5 text-gray-600 text-xs truncate max-w-32">{o.storeName || "-"}</td>
                        <td className="py-3 px-5 text-gray-600 text-xs">{o.recipientName || "-"}</td>
                        <td className="py-3 px-5 text-gray-500 text-xs font-mono">{o.recipientPhone || "-"}</td>
                        <td className="py-3 px-5 text-xs font-mono text-gray-600">{item?.skuCode || "-"}</td>
                        <td className="py-3 px-5 text-gray-600 text-xs truncate max-w-32">{item?.skuName || "-"}</td>
                        <td className="py-3 px-5 pr-8 text-right text-gray-600 text-xs tabular-nums w-28">{item?.skuQuantity ?? "-"}</td>
                        <td className="py-3 px-5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            group.status === "imported" || group.status === "submitted" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                          }`}>{group.status}</span>
                        </td>
                        <td className="py-3 px-5 text-right text-gray-400 text-xs whitespace-nowrap">
                          {group.createdAt ? new Date(group.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}
                        </td>
                        {isFirst && (
                          <td rowSpan={showRows.length} className="py-4 px-5 text-center align-top">
                            <button onClick={() => handleDelete(group.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              删除
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-gray-400">共 {total} 条，第 {page}/{totalPages} 页</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:border-teal-300 transition-colors">上一页</button>
            <span className="text-sm font-medium text-gray-600 px-2">{page}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:border-teal-300 transition-colors">下一页</button>
          </div>
        </div>
      )}
    </div>
  );
}
