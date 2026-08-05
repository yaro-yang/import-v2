"use client";

import { useEffect, useState, useCallback, use } from "react";
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
  batches?: Array<{
    batch_index: number;
    start_row: number;
    end_row: number;
    status: string;
    retry_count: number;
    performance?: {
      parse_duration_ms: number;
      rule_duration_ms: number;
      validate_duration_ms: number;
      insert_duration_ms: number;
      total_duration_ms: number;
    };
  }>;
}

interface TaskError {
  id: string;
  batch_index: number;
  row_number: number;
  field_name: string;
  raw_value: string;
  error_code: string;
  error_reason: string;
  created_at: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: "等待处理", color: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200" },
  PROCESSING: { label: "处理中", color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  COMPLETED: { label: "已完成", color: "text-green-600", bg: "bg-green-50 border-green-200" },
  PARTIAL_SUCCESS: { label: "部分成功", color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
  FAILED: { label: "失败", color: "text-red-600", bg: "bg-red-50 border-red-200" },
};

const ERROR_CODE_MAP: Record<string, string> = {
  E001: "SKU不存在",
  E002: "必填字段缺失",
  E003: "电话格式错误",
  E004: "数量不是正数",
  E005: "外部编码重复",
  E006: "规则映射失败",
  E007: "数据库写入失败",
  E008: "文件格式不支持",
};

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = use(params);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [errors, setErrors] = useState<TaskError[]>([]);
  const [errorTotal, setErrorTotal] = useState(0);
  const [errorPage, setErrorPage] = useState(1);
  const [errorFilter, setErrorFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/import-tasks/${taskId}?include=batches`);
      const data = await res.json();
      setTask(data);
    } catch (err) {
      console.error("获取任务详情失败:", err);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const fetchErrors = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("page", String(errorPage));
      params.set("page_size", "20");
      if (errorFilter) params.set("error_code", errorFilter);

      const res = await fetch(`/api/import-tasks/${taskId}/errors?${params}`);
      const data = await res.json();
      setErrors(data.errors || []);
      setErrorTotal(data.total || 0);
    } catch (err) {
      console.error("获取错误详情失败:", err);
    }
  }, [taskId, errorPage, errorFilter]);

  // 同时触发 dispatch
  const triggerDispatch = useCallback(async () => {
    try {
      await fetch("/api/import-tasks/dispatch", { method: "POST" });
    } catch {
      // 静默失败
    }
  }, []);

  useEffect(() => {
    fetchTask();
    fetchErrors();

    // 轮询更新
    const interval = setInterval(() => {
      fetchTask();
      fetchErrors();
      triggerDispatch();
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchTask, fetchErrors, triggerDispatch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-[#86909c]">加载中...</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="text-center py-20">
        <p className="text-[#86909c]">任务不存在</p>
        <Link href="/import-tasks" className="text-[#0fc6c2] text-sm mt-2 inline-block">
          返回任务列表
        </Link>
      </div>
    );
  }

  const statusInfo = STATUS_MAP[task.status] || STATUS_MAP.PENDING;
  const progress = task.total_rows > 0
    ? Math.round((task.processed_rows / task.total_rows) * 100)
    : 0;

  // 计算预计剩余时间
  const startedAt = task.created_at ? new Date(task.created_at).getTime() : Date.now();
  const elapsed = (Date.now() - startedAt) / 1000;
  const rowsPerSec = elapsed > 0 ? task.processed_rows / elapsed : 0;
  const remainingRows = task.total_rows - task.processed_rows;
  const estimatedRemaining = rowsPerSec > 0 ? remainingRows / rowsPerSec : 0;

  return (
    <div className="space-y-6">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-[#86909c]">
        <Link href="/import-tasks" className="hover:text-[#0fc6c2]">
          导入任务
        </Link>
        <span>/</span>
        <span className="text-[#1d2129]">{task.task_id}</span>
      </div>

      {/* 任务概览 */}
      <div className={`rounded-xl border p-6 ${statusInfo.bg}`}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#1d2129]">{task.file_name}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-[#86909c]">
              <span>Task: {task.task_id}</span>
              <span>Trace: {task.trace_id}</span>
            </div>
          </div>
          <span className={`inline-flex px-3 py-1.5 rounded-full text-sm font-medium ${statusInfo.color} bg-white/80`}>
            {statusInfo.label}
          </span>
        </div>

        {/* 进度条 */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-[#86909c]">
              进度: {task.processed_rows} / {task.total_rows} ({progress}%)
            </span>
            {task.status === "PROCESSING" && (
              <span className="text-[#86909c]">
                吞吐: {rowsPerSec.toFixed(1)} 行/秒 | 预计剩余: {estimatedRemaining.toFixed(0)}秒
              </span>
            )}
          </div>
          <div className="w-full h-3 bg-white rounded-full overflow-hidden border border-[#e5e6eb]">
            <div
              className="h-full bg-gradient-to-r from-[#0fc6c2] to-[#0bada9] rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-4 mt-5">
          <div className="bg-white/80 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-[#1d2129]">{task.total_rows.toLocaleString()}</div>
            <div className="text-xs text-[#86909c] mt-1">总行数</div>
          </div>
          <div className="bg-white/80 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-[#00b42a]">{task.success_rows.toLocaleString()}</div>
            <div className="text-xs text-[#86909c] mt-1">成功</div>
          </div>
          <div className="bg-white/80 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-[#f53f3f]">{task.failed_rows.toLocaleString()}</div>
            <div className="text-xs text-[#86909c] mt-1">失败</div>
          </div>
          <div className="bg-white/80 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-[#1d2129]">
              {task.completed_batches} / {task.total_batches}
            </div>
            <div className="text-xs text-[#86909c] mt-1">批次数</div>
          </div>
        </div>

        {task.degraded && (
          <div className="mt-4 bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm text-orange-700">
            ⚠️ SKU 校验已降级：本次导入未经过商品主数据完整校验，数据可能需要后续复核。
          </div>
        )}
      </div>

      {/* 批次详情 */}
      {task.batches && task.batches.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
          <h2 className="text-base font-semibold text-[#1d2129] mb-4">批次处理详情</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fafbfc] border-b border-[#e5e6eb]">
                  <th className="text-left px-4 py-2.5 font-medium text-[#86909c]">批次</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">行范围</th>
                  <th className="text-center px-4 py-2.5 font-medium text-[#86909c]">状态</th>
                  <th className="text-center px-4 py-2.5 font-medium text-[#86909c]">重试</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">解析(ms)</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">规则(ms)</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">校验(ms)</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">写入(ms)</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">总耗时(ms)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f2f3f5]">
                {task.batches.map((batch) => (
                  <tr key={batch.batch_index} className="hover:bg-[#fafbfc]">
                    <td className="px-4 py-3 font-medium">#{batch.batch_index + 1}</td>
                    <td className="px-4 py-3 text-right text-[#86909c]">
                      {batch.start_row} - {batch.end_row}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        batch.status === "COMPLETED" ? "bg-green-100 text-green-700" :
                        batch.status === "PROCESSING" ? "bg-blue-100 text-blue-700" :
                        batch.status === "FAILED" ? "bg-red-100 text-red-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {batch.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-[#86909c]">{batch.retry_count}</td>
                    {batch.performance ? (
                      <>
                        <td className="px-4 py-3 text-right text-[#86909c]">{batch.performance.parse_duration_ms}</td>
                        <td className="px-4 py-3 text-right text-[#86909c]">{batch.performance.rule_duration_ms}</td>
                        <td className="px-4 py-3 text-right text-[#86909c]">{batch.performance.validate_duration_ms}</td>
                        <td className="px-4 py-3 text-right text-[#86909c]">{batch.performance.insert_duration_ms}</td>
                        <td className="px-4 py-3 text-right font-medium text-[#1d2129]">{batch.performance.total_duration_ms}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-4 py-3 text-center text-[#c9cdd4]">—</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 错误详情 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#1d2129]">
            错误详情 ({errorTotal})
          </h2>
          <select
            value={errorFilter}
            onChange={(e) => { setErrorFilter(e.target.value); setErrorPage(1); }}
            className="text-sm border border-[#e5e6eb] rounded-lg px-3 py-1.5 outline-none focus:border-[#0fc6c2]"
          >
            <option value="">全部类型</option>
            {Object.entries(ERROR_CODE_MAP).map(([code, label]) => (
              <option key={code} value={code}>{code} - {label}</option>
            ))}
          </select>
        </div>

        {errors.length === 0 ? (
          <div className="text-center py-10 text-[#86909c]">
            {task.status === "PROCESSING" ? "处理中..." : "暂无错误"}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#fafbfc] border-b border-[#e5e6eb]">
                    <th className="text-left px-4 py-2.5 font-medium text-[#86909c]">批次</th>
                    <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">行号</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[#86909c]">字段</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[#86909c]">错误码</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[#86909c]">原因</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[#86909c]">原始值</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f2f3f5]">
                  {errors.map((err) => (
                    <tr key={err.id} className="hover:bg-[#fafbfc]">
                      <td className="px-4 py-3">#{err.batch_index + 1}</td>
                      <td className="px-4 py-3 text-right">{err.row_number}</td>
                      <td className="px-4 py-3">{err.field_name}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-red-50 text-red-600 font-medium">
                          {err.error_code}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#86909c] max-w-[300px] truncate">
                        {err.error_reason}
                      </td>
                      <td className="px-4 py-3 text-[#86909c] max-w-[150px] truncate font-mono text-xs">
                        {err.raw_value || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {errorTotal > 20 && (
              <div className="flex items-center justify-center gap-3 mt-4">
                <button
                  onClick={() => setErrorPage(Math.max(1, errorPage - 1))}
                  disabled={errorPage === 1}
                  className="text-sm px-3 py-1.5 rounded border border-[#e5e6eb] disabled:opacity-30 hover:border-[#0fc6c2]"
                >
                  上一页
                </button>
                <span className="text-sm text-[#86909c]">
                  第 {errorPage} / {Math.ceil(errorTotal / 20)} 页
                </span>
                <button
                  onClick={() => setErrorPage(errorPage + 1)}
                  disabled={errorPage >= Math.ceil(errorTotal / 20)}
                  className="text-sm px-3 py-1.5 rounded border border-[#e5e6eb] disabled:opacity-30 hover:border-[#0fc6c2]"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Trace 链接 */}
      <div className="text-center">
        <Link
          href={`/import-tasks/trace/${task.trace_id}`}
          className="text-sm text-[#0fc6c2] hover:underline"
        >
          查看全链路 Trace →
        </Link>
      </div>
    </div>
  );
}
