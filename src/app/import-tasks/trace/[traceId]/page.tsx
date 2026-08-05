"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface TimelineEvent {
  occurred_at: string;
  event_name: string;
  event_status: string;
  message: string;
  batch_index: number | null;
}

interface TraceData {
  trace_id: string;
  task_id: string;
  file_name: string;
  status: string;
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  timeline: TimelineEvent[];
}

const EVENT_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  ImportTaskCreated: { icon: "M12 4v16m8-8H4", color: "text-blue-500", bg: "bg-blue-50 ring-blue-200" },
  ImportBatchStarted: { icon: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z", color: "text-teal-500", bg: "bg-teal-50 ring-teal-200" },
  ImportBatchSucceeded: { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", color: "text-emerald-500", bg: "bg-emerald-50 ring-emerald-200" },
  ImportTaskCompleted: { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", color: "text-emerald-500", bg: "bg-emerald-50 ring-emerald-200" },
  ImportTaskPartialSuccess: { icon: "M12 9v2m0 4h.01", color: "text-amber-500", bg: "bg-amber-50 ring-amber-200" },
  SKUValidationDegraded: { icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z", color: "text-amber-500", bg: "bg-amber-50 ring-amber-200" },
};

const defaultIcon = { icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: "text-gray-400", bg: "bg-gray-50 ring-gray-200" };

export default function TracePage() {
  const params = useParams();
  const traceId = params.traceId as string;

  const [data, setData] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTrace = useCallback(async () => {
    try {
      const res = await fetch(`/api/traces/${traceId}`);
      setData(await res.json());
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, [traceId]);

  useEffect(() => {
    fetchTrace();
  }, [fetchTrace]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 bg-gray-100 rounded-xl w-48" />
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-gray-100" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-1/3" />
                <div className="h-3 bg-gray-50 rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-3xl mx-auto text-center py-24">
        <p className="text-gray-400">Trace 不存在</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* 头部 */}
      <div>
        <Link href="/import-tasks" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-teal-500 transition-colors mb-3">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回任务列表
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">全链路 Trace</h1>
        <p className="text-sm text-gray-400 mt-1.5 font-mono">{data.trace_id}</p>
      </div>

      {/* 概览 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">关联任务</h2>
          <Link
            href={`/import-tasks/${data.task_id}`}
            className="inline-flex items-center gap-1 text-sm text-teal-500 hover:text-teal-600 font-medium transition-colors"
          >
            {data.task_id}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">文件</div>
            <div className="text-sm font-semibold text-gray-900 truncate">{data.file_name}</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">总行数</div>
            <div className="text-2xl font-bold text-gray-900 tabular-nums">{data.total_rows.toLocaleString()}</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">结果</div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500 font-bold tabular-nums">{data.success_rows.toLocaleString()}</span>
              <span className="text-gray-300">/</span>
              <span className={`font-bold tabular-nums ${data.failed_rows > 0 ? "text-rose-500" : "text-gray-400"}`}>{data.failed_rows.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 时间线 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-5">事件时间线</h2>
        {data.timeline.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
            <p className="text-gray-300 text-sm">暂无事件</p>
          </div>
        ) : (
          <div className="relative">
            {/* 竖线 */}
            <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-gray-100" />

            <div className="space-y-0">
              {data.timeline.map((event, i) => {
                const ei = EVENT_ICONS[event.event_name] || defaultIcon;
                const time = new Date(event.occurred_at);
                const isFirst = i === 0;
                const isLast = i === data.timeline.length - 1;

                return (
                  <div key={i} className="relative flex gap-5 pb-6 last:pb-0">
                    {/* 节点 */}
                    <div className={`relative z-10 w-10 h-10 rounded-full ring-4 ring-white flex items-center justify-center flex-shrink-0 ${ei.bg} ${isFirst ? "scale-110" : ""}`}>
                      <svg className={`w-5 h-5 ${ei.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ei.icon} />
                      </svg>
                    </div>

                    {/* 内容 */}
                    <div className="flex-1 pt-1.5">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-sm font-semibold text-gray-900">
                          {event.event_name.replace(/([A-Z])/g, " $1").trim()}
                        </span>
                        {event.batch_index !== null && event.batch_index !== undefined && (
                          <span className="px-2 py-0.5 text-xs font-mono bg-gray-100 text-gray-500 rounded-md">
                            batch #{event.batch_index}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${event.event_status === "OK" ? "text-emerald-500" : "text-rose-500"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${event.event_status === "OK" ? "bg-emerald-400" : "bg-rose-400"}`} />
                          {event.event_status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 leading-relaxed">{event.message}</p>
                      <p className="text-xs text-gray-300 mt-1.5 font-mono">
                        {time.toLocaleString("zh-CN", {
                          year: "numeric", month: "2-digit", day: "2-digit",
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                          fractionalSecondDigits: 3,
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
