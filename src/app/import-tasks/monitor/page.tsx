"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface MonitorData {
  throughput_5min: { minute: string; rows: number }[];
  queue_depth: { pending_batches: string; pending_rows: string; alert: string };
  stage_stats: {
    parse: { p50: number; p95: number; p99: number };
    rule: { p50: number; p95: number; p99: number };
    validate: { p50: number; p95: number; p99: number };
    insert: { p50: number; p95: number; p99: number };
  };
  error_distribution: { error_code: string; count: string }[];
  recent_tasks: { task_id: string; file_name: string; status: string; total_rows: number; success_rows: number; failed_rows: number; created_at: string }[];
}

function formatMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const MAX_BAR_HEIGHT = 120;

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/import-monitor/summary");
      setData(await res.json());
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 bg-gray-100 rounded-xl w-32" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 h-48" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const maxThroughput = Math.max(1, ...data.throughput_5min.map((t) => t.rows));

  const stageLabels: Record<string, string> = { parse: "解析", rule: "规则/AI", validate: "校验", insert: "写入" };
  const stageColors: Record<string, string> = {
    parse: "from-teal-500 to-cyan-500",
    rule: "from-blue-500 to-indigo-500",
    validate: "from-amber-500 to-orange-500",
    insert: "from-emerald-500 to-green-500",
  };
  const stageBgs: Record<string, string> = {
    parse: "bg-teal-50 text-teal-600",
    rule: "bg-blue-50 text-blue-600",
    validate: "bg-amber-50 text-amber-600",
    insert: "bg-emerald-50 text-emerald-600",
  };

  const queueAlertStyles: Record<string, string> = {
    green: "bg-emerald-50 border-emerald-200 text-emerald-700",
    yellow: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-rose-50 border-rose-200 text-rose-700",
  };
  const queueAlert = queueAlertStyles[data.queue_depth.alert] || queueAlertStyles.green;

  return (
    <div className="space-y-8">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">监控看板</h1>
          <p className="text-sm text-gray-500 mt-1.5">实时吞吐量、队列积压、阶段耗时、错误分布</p>
        </div>
        <Link
          href="/import-tasks"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-teal-500 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回任务列表
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. 实时吞吐量 */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
            <svg className="w-4 h-4 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            实时吞吐量（5分钟）
          </h2>
          {data.throughput_5min.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-300 text-sm">暂无数据</div>
          ) : (
            <div className="flex items-end gap-2 h-40">
              {data.throughput_5min.map((t) => {
                const h = (t.rows / maxThroughput) * MAX_BAR_HEIGHT;
                return (
                  <div key={t.minute} className="flex-1 flex flex-col items-center gap-1.5">
                    <span className="text-xs font-semibold text-teal-600 tabular-nums">{t.rows.toLocaleString()}</span>
                    <div
                      className="w-full bg-gradient-to-t from-teal-500 to-cyan-400 rounded-t-lg transition-all duration-500 min-h-[4px]"
                      style={{ height: `${Math.max(h, 4)}px` }}
                    />
                    <span className="text-[10px] text-gray-400">
                      {new Date(t.minute + ":00").toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. 队列积压 */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            队列积压
          </h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">待处理批次</div>
              <div className="text-3xl font-bold text-gray-900 tabular-nums">{data.queue_depth.pending_batches}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">待处理行数</div>
              <div className="text-3xl font-bold text-gray-900 tabular-nums">{data.queue_depth.pending_rows.toLocaleString()}</div>
            </div>
          </div>
          <div className={`rounded-xl px-4 py-3 border text-sm font-medium ${queueAlert}`}>
            {data.queue_depth.alert === "green" && "✅ 队列正常，无积压"}
            {data.queue_depth.alert === "yellow" && "⚠️ 队列积压，请关注"}
            {data.queue_depth.alert === "red" && "🔴 严重积压，需要扩容"}
          </div>
        </div>

        {/* 3. 阶段耗时分布 */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            阶段耗时分布
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-400 uppercase tracking-wider">阶段</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-400 uppercase tracking-wider">P50</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-400 uppercase tracking-wider">P95</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-400 uppercase tracking-wider">P99</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.stage_stats).map(([key, stats]) => (
                  <tr key={key} className="border-b border-gray-50 hover:bg-gray-50/30 transition-colors">
                    <td className="py-3 px-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${stageBgs[key] || ""}`}>
                        {stageLabels[key] || key}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-gray-700 font-mono tabular-nums">{formatMs(stats.p50)}</td>
                    <td className="py-3 px-3 text-right text-gray-700 font-mono tabular-nums">{formatMs(stats.p95)}</td>
                    <td className="py-3 px-3 text-right text-gray-700 font-mono tabular-nums">{formatMs(stats.p99)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. 错误分布 */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
            <svg className="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            错误类型分布
          </h2>
          {data.error_distribution.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-300 text-sm">暂无错误</div>
          ) : (
            <div className="space-y-3">
              {data.error_distribution.map((e) => {
                const maxCount = Math.max(...data.error_distribution.map((d) => Number(d.count)));
                const pct = maxCount > 0 ? (Number(e.count) / maxCount) * 100 : 0;
                return (
                  <div key={e.error_code}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono font-medium text-rose-600">{e.error_code}</span>
                      <span className="text-xs text-gray-400 tabular-nums">{e.count}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-rose-400 to-rose-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 最近任务 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">最近任务</h2>
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">任务</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">文件</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">状态</th>
                  <th className="text-right py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">总行</th>
                  <th className="text-right py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">成功</th>
                  <th className="text-right py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">失败</th>
                  <th className="text-right py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">时间</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_tasks.map((t) => {
                  const sMap: Record<string, { bg: string; text: string; label: string }> = {
                    PENDING: { bg: "bg-amber-50", text: "text-amber-600", label: "等待" },
                    PROCESSING: { bg: "bg-sky-50", text: "text-sky-600", label: "处理中" },
                    COMPLETED: { bg: "bg-emerald-50", text: "text-emerald-600", label: "完成" },
                    PARTIAL_SUCCESS: { bg: "bg-orange-50", text: "text-orange-600", label: "部分" },
                    FAILED: { bg: "bg-rose-50", text: "text-rose-600", label: "失败" },
                  };
                  const sm = sMap[t.status] || sMap.PENDING;
                  return (
                    <tr key={t.task_id} className="border-b border-gray-50 hover:bg-gray-50/30 transition-colors">
                      <td className="py-4 px-5">
                        <Link href={`/import-tasks/${t.task_id}`} className="font-mono text-xs text-teal-500 hover:text-teal-600 hover:underline transition-colors">
                          {t.task_id.slice(0, 12)}...
                        </Link>
                      </td>
                      <td className="py-4 px-5 text-gray-700">{t.file_name}</td>
                      <td className="py-4 px-5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sm.bg} ${sm.text}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {sm.label}
                        </span>
                      </td>
                      <td className="py-4 px-5 text-right text-gray-600 tabular-nums">{t.total_rows.toLocaleString()}</td>
                      <td className="py-4 px-5 text-right text-emerald-500 font-medium tabular-nums">{t.success_rows.toLocaleString()}</td>
                      <td className="py-4 px-5 text-right tabular-nums">{t.failed_rows > 0 ? <span className="text-rose-500 font-medium">{t.failed_rows.toLocaleString()}</span> : <span className="text-gray-300">0</span>}</td>
                      <td className="py-4 px-5 text-right text-gray-400 text-xs">
                        {new Date(t.created_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
