"use client";

import { useState, useEffect, useCallback } from "react";

interface OutboundItem {
  id: string;
  skuCode: string;
  skuName: string;
  skuQuantity: number;
}

interface OutboundOrder {
  id: string;
  externalCode?: string;
  status: string;
  sourceFile: string;
  sourceRow: number;
  createdAt: string;
  items: OutboundItem[];
  storeName?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
}

export default function HistoryPage() {
  const [orders, setOrders] = useState<OutboundOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 20;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders?page=${page}&pageSize=${pageSize}`);
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
  }, [page]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const totalPages = Math.ceil(total / pageSize);

  if (error) {
    return (
      <div className="p-20 text-center">
        <p className="text-gray-500 text-lg mb-2">加载失败</p>
        <p className="text-gray-400 text-sm mb-4">{error}</p>
        <button onClick={loadOrders} className="px-4 py-2 bg-teal-500 text-white rounded-lg text-sm">重试</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-10 space-y-4">
        <h1 className="text-xl font-bold text-gray-900">已导入运单</h1>
        {[1,2,3,4,5].map(i => (
          <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">已导入运单</h1>
        <span className="text-sm text-gray-400">共 {total} 条</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase">外部编码</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase">来源文件</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase">源行</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase">SKU</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-gray-400 uppercase">数量</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase">状态</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-gray-400 uppercase">时间</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const safeItems = Array.isArray(order.items) ? order.items : [];
                return (
                  <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50/30 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-gray-600">{order.externalCode || "-"}</td>
                    <td className="py-3 px-4 text-gray-500 text-xs max-w-40 truncate">{order.sourceFile || "-"}</td>
                    <td className="py-3 px-4 text-gray-400 tabular-nums text-xs">{order.sourceRow}</td>
                    <td className="py-3 px-4">
                      {safeItems.length === 0 ? (
                        <span className="text-gray-300">-</span>
                      ) : (
                        <div className="space-y-0.5">
                          {safeItems.slice(0, 3).map((item) => (
                            <div key={item.id} className="text-xs">
                              <span className="text-gray-700">{item.skuCode || "-"}</span>
                              <span className="text-gray-400 ml-1">{item.skuName || ""}</span>
                            </div>
                          ))}
                          {safeItems.length > 3 && <span className="text-xs text-gray-400">+{safeItems.length - 3} 更多</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-xs text-gray-600">
                      {safeItems.reduce((s, i) => s + (Number(i?.skuQuantity) || 0), 0)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600">
                        {order.status || "-"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-400 text-xs">
                      {order.createdAt ? new Date(order.createdAt).toLocaleDateString("zh-CN") : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30">上一页</button>
          <span className="text-sm text-gray-500">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30">下一页</button>
        </div>
      )}
    </div>
  );
}
