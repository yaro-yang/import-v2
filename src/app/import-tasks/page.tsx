"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface ImportTask {
  task_id: string;
  file_name: string;
  status: string;
  total_rows: number;
  processed_rows: number;
  success_rows: number;
  failed_rows: number;
  total_batches: number;
  completed_batches: number;
  trace_id: string;
  created_at: string;
  completed_at: string | null;
}

const STATUS_MAP: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  PENDING: { label: "等待处理", bg: "bg-amber-50", text: "text-amber-600", dot: "bg-amber-400" },
  PROCESSING: { label: "处理中", bg: "bg-sky-50", text: "text-sky-600", dot: "bg-sky-400 animate-pulse" },
  COMPLETED: { label: "已完成", bg: "bg-emerald-50", text: "text-emerald-600", dot: "bg-emerald-400" },
  PARTIAL_SUCCESS: { label: "部分成功", bg: "bg-orange-50", text: "text-orange-600", dot: "bg-orange-400" },
  FAILED: { label: "失败", bg: "bg-rose-50", text: "text-rose-600", dot: "bg-rose-400" },
};

export default function ImportTasksPage() {
  const [tasks, setTasks] = useState<ImportTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/import-tasks/list");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      // 静默处理
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">导入任务</h1>
          <p className="text-sm text-gray-500 mt-1.5">异步导入任务列表与进度追踪</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/import-tasks/search"
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-all shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            搜索
          </Link>
          <Link
            href="/import-tasks/monitor"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 rounded-xl hover:from-teal-600 hover:to-cyan-600 transition-all shadow-md shadow-teal-500/25"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            监控看板
          </Link>
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-1/3" />
                  <div className="h-3 bg-gray-50 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-20 text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gray-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">暂无导入任务</p>
          <Link href="/" className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-teal-500 hover:text-teal-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            上传文件
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const statusInfo = STATUS_MAP[task.status] || STATUS_MAP.PENDING;
            const progress = task.total_rows > 0
              ? Math.round((task.processed_rows / task.total_rows) * 100)
              : 0;
            const isDone = task.status === "COMPLETED" || task.status === "PARTIAL_SUCCESS" || task.status === "FAILED";

            return (
              <Link
                key={task.task_id}
                href={`/import-tasks/${task.task_id}`}
                className="block bg-white rounded-2xl border border-gray-100 p-5 hover:border-teal-200 hover:shadow-lg hover:shadow-teal-500/5 transition-all duration-200 group"
              >
                <div className="flex items-center gap-5">
                  {/* 文件图标 */}
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-50 to-cyan-50 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                    <svg className="w-5 h-5 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="font-semibold text-gray-900 truncate">{task.file_name}</span>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.bg} ${statusInfo.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                        {statusInfo.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <span className="font-mono">{task.task_id}</span>
                      <span>·</span>
                      <span>{task.completed_batches}/{task.total_batches} 批次</span>
                      <span>·</span>
                      <span>{new Date(task.created_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>

                  {/* 进度 */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-emerald-500 tabular-nums">{task.success_rows.toLocaleString()}</span>
                        <span className="text-gray-300">/</span>
                        <span className={`font-semibold tabular-nums ${task.failed_rows > 0 ? "text-rose-500" : "text-gray-400"}`}>{task.failed_rows.toLocaleString()}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{task.total_rows.toLocaleString()} 总行</div>
                    </div>
                    <div className="w-28">
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>{progress}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${isDone ? "bg-gradient-to-r from-teal-400 to-emerald-400" : "bg-gradient-to-r from-teal-400 to-cyan-400 progress-striped"}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    <svg className="w-5 h-5 text-gray-300 group-hover:text-teal-400 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
