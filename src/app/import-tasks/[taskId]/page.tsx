"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface TaskDetail {
  task_id: string;
  file_name: string;
  status: string;
  total_rows: number;
  processed_rows: number;
  success_rows: number;
  failed_rows: number;
  total_batches: number;
  completed_batches: number;
  degraded: boolean;
  trace_id: string;
  created_at: string;
  completed_at: string | null;
}

interface BatchInfo {
  batch_index: number;
  start_row: number;
  end_row: number;
  status: string;
  retry_count: number;
  locked_at: string | null;
  completed_at: string | null;
  performance: {
    parse_duration_ms: number;
    rule_duration_ms: number;
    validate_duration_ms: number;
    insert_duration_ms: number;
    total_duration_ms: number;
  } | null;
}

interface ErrorInfo {
  id: string;
  row_number: number;
  field_name: string;
  raw_value: string;
  error_code: string;
  error_reason: string;
}

const STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  PENDING: { label: "等待处理", bg: "bg-amber-50", text: "text-amber-600" },
  PROCESSING: { label: "处理中", bg: "bg-sky-50", text: "text-sky-600" },
  COMPLETED: { label: "已完成", bg: "bg-emerald-50", text: "text-emerald-600" },
  PARTIAL_SUCCESS: { label: "部分成功", bg: "bg-orange-50", text: "text-orange-600" },
  FAILED: { label: "失败", bg: "bg-rose-50", text: "text-rose-600" },
};

function formatMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = params.taskId as string;

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [errors, setErrors] = useState<ErrorInfo[]>([]);
  const [errorTotal, setErrorTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [taskRes, batchRes, errRes] = await Promise.all([
        fetch(`/api/import-tasks/${taskId}`),
        fetch(`/api/import-tasks/${taskId}/batches`),
        fetch(`/api/import-tasks/${taskId}/errors`),
      ]);
      const [taskData, batchData, errData] = await Promise.all([
        taskRes.json(),
        batchRes.json(),
        errRes.json(),
      ]);
      setTask(taskData);
      setBatches(batchData.batches || []);
      setErrors(errData.errors || []);
      setErrorTotal(errData.total || 0);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 2000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 bg-gray-100 rounded-xl w-48" />
        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          <div className="space-y-4">
            <div className="h-4 bg-gray-100 rounded w-1/3" />
            <div className="h-4 bg-gray-50 rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="max-w-5xl mx-auto text-center py-24">
        <p className="text-gray-400">任务不存在</p>
      </div>
    );
  }

  const statusInfo = STATUS_MAP[task.status] || STATUS_MAP.PENDING;
  const progress = task.total_rows > 0 ? Math.round(((task.success_rows + task.failed_rows) / task.total_rows) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* 面包屑 + 标题 */}
      <div>
        <Link href="/import-tasks" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-teal-500 transition-colors mb-3">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回任务列表
        </Link>
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900">{task.file_name}</h1>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bg} ${statusInfo.text}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {statusInfo.label}
          </span>
        </div>
        <p className="text-sm text-gray-400 mt-1.5 font-mono">{task.task_id}</p>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "总行数", value: task.total_rows.toLocaleString(), icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
          { label: "成功", value: task.success_rows.toLocaleString(), color: "text-emerald-500", bg: "bg-emerald-50", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
          { label: "失败", value: task.failed_rows.toLocaleString(), color: task.failed_rows > 0 ? "text-rose-500" : "text-gray-400", bg: task.failed_rows > 0 ? "bg-rose-50" : "bg-gray-50", icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" },
          { label: "批次", value: `${task.completed_batches}/${task.total_batches}`, icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
        ].map((card, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{card.label}</span>
              <div className={`w-8 h-8 rounded-lg ${card.bg || "bg-teal-50"} flex items-center justify-center`}>
                <svg className={`w-4 h-4 ${card.color || "text-teal-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={card.icon} />
                </svg>
              </div>
            </div>
            <div className={`text-2xl font-bold ${card.color || "text-gray-900"} tabular-nums`}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* 进度条 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-700">处理进度</span>
          <span className="text-sm text-gray-400 tabular-nums">{progress}%</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-400 transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-3 text-xs text-gray-400">
          <span>创建：{new Date(task.created_at).toLocaleString("zh-CN")}</span>
          <span>{task.completed_at ? `完成：${new Date(task.completed_at).toLocaleString("zh-CN")}` : ""}</span>
        </div>
      </div>

      {/* 降级提示 */}
      {task.degraded && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <p className="font-semibold text-amber-700 text-sm">SKU 校验已降级</p>
            <p className="text-amber-600 text-sm mt-1">数据库连接异常，当前使用本地缓存进行 SKU 校验，可能影响准确性。</p>
          </div>
        </div>
      )}

      {/* Trace 快捷入口 */}
      <div className="flex items-center gap-3">
        <Link
          href={`/import-tasks/trace/${task.trace_id}`}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 rounded-xl hover:from-teal-600 hover:to-cyan-600 transition-all shadow-md shadow-teal-500/25"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          查看全链路 Trace
        </Link>
        <span className="text-xs text-gray-400 font-mono">{task.trace_id}</span>
      </div>

      {/* 批次详情 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">批次详情</h2>
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">#</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">行范围</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">状态</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">重试</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">解析</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">规则</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">校验</th>
                  <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">写入</th>
                  <th className="text-right py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">总耗时</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const bStatus = STATUS_MAP[b.status] || STATUS_MAP.PENDING;
                  return (
                    <tr key={b.batch_index} className="border-b border-gray-50 hover:bg-gray-50/30 transition-colors">
                      <td className="py-4 px-5 font-mono text-gray-400">{b.batch_index}</td>
                      <td className="py-4 px-5 text-gray-700 tabular-nums">{b.start_row}–{b.end_row}</td>
                      <td className="py-4 px-5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${bStatus.bg} ${bStatus.text}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {bStatus.label}
                        </span>
                      </td>
                      <td className="py-4 px-5 text-gray-400 tabular-nums">{b.retry_count}</td>
                      {b.performance ? (
                        <>
                          <td className="py-4 px-5 text-gray-600 tabular-nums font-mono text-xs">{formatMs(b.performance.parse_duration_ms)}</td>
                          <td className="py-4 px-5 text-gray-600 tabular-nums font-mono text-xs">{formatMs(b.performance.rule_duration_ms)}</td>
                          <td className="py-4 px-5 text-gray-600 tabular-nums font-mono text-xs">{formatMs(b.performance.validate_duration_ms)}</td>
                          <td className="py-4 px-5 text-gray-600 tabular-nums font-mono text-xs">{formatMs(b.performance.insert_duration_ms)}</td>
                          <td className="py-4 px-5 text-right font-semibold text-teal-600 tabular-nums font-mono text-xs">{formatMs(b.performance.total_duration_ms)}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="py-4 px-5 text-gray-300">-</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 错误明细 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          错误明细
          <span className="ml-2 text-sm font-normal text-gray-400">({errorTotal})</span>
        </h2>
        {errors.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-emerald-50 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">无错误记录</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">行号</th>
                    <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">字段</th>
                    <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">错误码</th>
                    <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">原因</th>
                    <th className="text-left py-4 px-5 text-xs font-medium text-gray-400 uppercase tracking-wider">原始值(脱敏)</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e) => (
                    <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/30 transition-colors">
                      <td className="py-4 px-5 font-mono text-gray-400 tabular-nums">{e.row_number}</td>
                      <td className="py-4 px-5 font-medium text-gray-700">{e.field_name}</td>
                      <td className="py-4 px-5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 text-xs font-mono font-medium">{e.error_code}</span>
                      </td>
                      <td className="py-4 px-5 text-gray-600">{e.error_reason}</td>
                      <td className="py-4 px-5 text-gray-400 font-mono text-xs max-w-48 truncate" title={e.raw_value}>{e.raw_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
