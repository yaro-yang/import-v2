"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";

interface TraceData {
  trace_id: string;
  task_id?: string;
  file_name?: string;
  status?: string;
  total_rows?: number;
  success_rows?: number;
  failed_rows?: number;
  timeline: Array<{
    occurred_at: string;
    event_name: string;
    event_status: string;
    message: string;
    batch_index?: number;
  }>;
}

const EVENT_ICONS: Record<string, string> = {
  FileUploaded: "📤",
  ImportTaskCreated: "📋",
  OutboxEventsCreated: "📨",
  ImportBatchStarted: "▶️",
  ImportBatchSucceeded: "✅",
  ImportBatchFailed: "❌",
  ImportTaskCompleted: "🏁",
  ImportTaskPartialSuccess: "⚠️",
  SKUValidationDegraded: "🔻",
};

export default function TracePage({
  params,
}: {
  params: Promise<{ traceId: string }>;
}) {
  const { traceId } = use(params);
  const [data, setData] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/traces/${traceId}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("获取Trace失败:", err);
    } finally {
      setLoading(false);
    }
  }, [traceId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-[#86909c]">加载中...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-[#86909c]">Trace 不存在</p>
        <Link href="/import-tasks" className="text-[#0fc6c2] text-sm mt-2 inline-block">
          返回任务列表
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-[#86909c]">
        <Link href="/import-tasks" className="hover:text-[#0fc6c2]">导入任务</Link>
        <span>/</span>
        {data.task_id && (
          <>
            <Link href={`/import-tasks/${data.task_id}`} className="hover:text-[#0fc6c2]">
              {data.task_id}
            </Link>
            <span>/</span>
          </>
        )}
        <span className="text-[#1d2129]">Trace: {data.trace_id}</span>
      </div>

      {/* 概览 */}
      {data.task_id && (
        <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
          <h1 className="text-lg font-semibold text-[#1d2129]">
            {data.file_name || "未知文件"}
          </h1>
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-[#1d2129]">{data.total_rows?.toLocaleString() || "—"}</div>
              <div className="text-xs text-[#86909c] mt-1">总行数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-[#00b42a]">{data.success_rows?.toLocaleString() || "—"}</div>
              <div className="text-xs text-[#86909c] mt-1">成功</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-[#f53f3f]">{data.failed_rows?.toLocaleString() || "—"}</div>
              <div className="text-xs text-[#86909c] mt-1">失败</div>
            </div>
            <div className="text-center">
              <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
                data.status === "COMPLETED" ? "bg-green-100 text-green-700" :
                data.status === "PARTIAL_SUCCESS" ? "bg-orange-100 text-orange-700" :
                data.status === "PROCESSING" ? "bg-blue-100 text-blue-700" :
                "bg-yellow-100 text-yellow-700"
              }`}>
                {data.status}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 时间线 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
        <h2 className="text-base font-semibold text-[#1d2129] mb-6">全链路时间线</h2>

        {data.timeline.length === 0 ? (
          <div className="text-center py-10 text-[#c9cdd4]">暂无事件记录</div>
        ) : (
          <div className="relative pl-8 border-l-2 border-[#e5e6eb] space-y-0">
            {data.timeline.map((event, i) => {
              const isError = event.event_status === "ERROR" || event.event_status === "WARN";
              const time = new Date(event.occurred_at).toLocaleTimeString("zh-CN", { hour12: false });

              return (
                <div key={i} className="relative pb-6 last:pb-0">
                  {/* 时间线圆点 */}
                  <div
                    className={`absolute -left-[29px] w-4 h-4 rounded-full border-2 ${
                      isError ? "bg-red-50 border-red-400" :
                      event.event_status === "WARN" ? "bg-orange-50 border-orange-400" :
                      "bg-white border-[#0fc6c2]"
                    }`}
                  />

                  <div className="ml-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#c9cdd4] font-mono">{time}</span>
                      <span className="text-sm font-medium text-[#1d2129]">
                        {EVENT_ICONS[event.event_name] || "•"} {event.event_name}
                      </span>
                      {event.batch_index !== undefined && (
                        <span className="text-xs text-[#86909c]">批次 #{event.batch_index + 1}</span>
                      )}
                    </div>
                    <p className={`text-sm mt-1 ${
                      isError ? "text-[#f53f3f]" : "text-[#86909c]"
                    }`}>
                      {event.message}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 搜索 */}
      <div className="text-center">
        <Link
          href="/import-tasks/search"
          className="text-sm text-[#0fc6c2] hover:underline"
        >
          搜索更多 Trace →
        </Link>
      </div>
    </div>
  );
}
