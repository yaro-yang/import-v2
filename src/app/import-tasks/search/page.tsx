"use client";

import { useState } from "react";
import Link from "next/link";

export default function TraceSearchPage() {
  const [taskId, setTaskId] = useState("");
  const [traceId, setTraceId] = useState("");
  const [fileName, setFileName] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [results, setResults] = useState<{
    tasks: Array<Record<string, unknown>>;
    errors: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (taskId) params.set("task_id", taskId);
      if (traceId) params.set("trace_id", traceId);
      if (fileName) params.set("file_name", fileName);
      if (errorCode) params.set("error_code", errorCode);

      const res = await fetch(`/api/import-tasks/search?${params}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error("搜索失败:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1d2129]">Trace 检索</h1>
          <p className="text-sm text-[#86909c] mt-1">按条件搜索导入任务和链路事件</p>
        </div>
      </div>

      {/* 搜索表单 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1d2129] mb-1.5">Task ID</label>
            <input
              type="text"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              placeholder="task_xxx"
              className="w-full px-3 py-2 border border-[#e5e6eb] rounded-lg text-sm outline-none focus:border-[#0fc6c2]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1d2129] mb-1.5">Trace ID</label>
            <input
              type="text"
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              placeholder="trace_xxx"
              className="w-full px-3 py-2 border border-[#e5e6eb] rounded-lg text-sm outline-none focus:border-[#0fc6c2]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1d2129] mb-1.5">文件名</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="10000-orders.xlsx"
              className="w-full px-3 py-2 border border-[#e5e6eb] rounded-lg text-sm outline-none focus:border-[#0fc6c2]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1d2129] mb-1.5">错误码</label>
            <input
              type="text"
              value={errorCode}
              onChange={(e) => setErrorCode(e.target.value)}
              placeholder="E001"
              className="w-full px-3 py-2 border border-[#e5e6eb] rounded-lg text-sm outline-none focus:border-[#0fc6c2]"
            />
          </div>
        </div>
        <button
          onClick={handleSearch}
          disabled={loading}
          className="mt-4 px-6 py-2 bg-[#0fc6c2] text-white rounded-lg text-sm font-medium hover:bg-[#0bada9] disabled:opacity-50 transition-colors"
        >
          {loading ? "搜索中..." : "搜索"}
        </button>
      </div>

      {/* 搜索结果 */}
      {results && (
        <div className="space-y-4">
          {/* 任务 */}
          <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
            <h2 className="text-base font-semibold text-[#1d2129] mb-4">
              任务 ({results.tasks.length})
            </h2>
            {results.tasks.length === 0 ? (
              <div className="text-center py-8 text-[#c9cdd4]">无匹配任务</div>
            ) : (
              <div className="space-y-3">
                {results.tasks.map((task: Record<string, unknown>) => (
                  <Link
                    key={task.id as string}
                    href={`/import-tasks/${task.id}`}
                    className="flex items-center justify-between p-4 rounded-lg border border-[#e5e6eb] hover:border-[#0fc6c2] transition-colors"
                  >
                    <div>
                      <div className="font-medium text-[#1d2129]">{task.file_name as string}</div>
                      <div className="text-xs text-[#86909c] mt-0.5">{task.id as string}</div>
                    </div>
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                      task.status === "COMPLETED" ? "bg-green-100 text-green-700" :
                      task.status === "PARTIAL_SUCCESS" ? "bg-orange-100 text-orange-700" :
                      "bg-blue-100 text-blue-700"
                    }`}>
                      {task.status as string}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 错误 */}
          {results.errors.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
              <h2 className="text-base font-semibold text-[#1d2129] mb-4">
                错误 ({results.errors.length})
              </h2>
              <div className="space-y-2">
                {results.errors.slice(0, 20).map((err: Record<string, unknown>) => (
                  <div key={err.id as string} className="flex items-center gap-3 text-sm p-3 bg-red-50 rounded-lg">
                    <span className="font-medium text-red-600">{err.error_code as string}</span>
                    <span className="text-[#86909c]">行 {err.row_number as number}</span>
                    <span className="text-[#86909c]">{err.field_name as string}</span>
                    <span className="flex-1 text-[#1d2129] truncate">{err.error_reason as string}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 事件时间线 */}
          {results.events.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
              <h2 className="text-base font-semibold text-[#1d2129] mb-4">
                链路事件 ({results.events.length})
              </h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {results.events.map((ev: Record<string, unknown>, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-sm p-2 hover:bg-[#fafbfc] rounded">
                    <span className="text-xs text-[#c9cdd4] font-mono w-20">
                      {new Date(ev.occurred_at as string).toLocaleTimeString("zh-CN", { hour12: false })}
                    </span>
                    <span className="font-medium text-[#1d2129]">{ev.event_name as string}</span>
                    <span className="text-[#86909c] truncate">{ev.message as string}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
