"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

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

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING: { label: "等待处理", color: "bg-yellow-100 text-yellow-700" },
  PROCESSING: { label: "处理中", color: "bg-blue-100 text-blue-700" },
  COMPLETED: { label: "已完成", color: "bg-green-100 text-green-700" },
  PARTIAL_SUCCESS: { label: "部分成功", color: "bg-orange-100 text-orange-700" },
  FAILED: { label: "失败", color: "bg-red-100 text-red-700" },
};

export default function ImportTasksPage() {
  const [tasks, setTasks] = useState<ImportTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/import-tasks/list");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error("获取任务列表失败:", err);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1d2129]">导入任务</h1>
          <p className="text-sm text-[#86909c] mt-1">
            异步导入任务列表与进度追踪
          </p>
        </div>
        <Link href="/import-tasks/monitor">
          <Button variant="secondary">监控看板</Button>
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-20 text-[#86909c]">加载中...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">📋</div>
          <p className="text-[#86909c]">暂无导入任务</p>
          <Link href="/" className="text-[#0fc6c2] text-sm mt-2 inline-block">
            去上传文件
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fafbfc] border-b border-[#e5e6eb]">
                  <th className="text-left px-5 py-3 font-medium text-[#86909c]">文件名</th>
                  <th className="text-left px-5 py-3 font-medium text-[#86909c]">状态</th>
                  <th className="text-right px-5 py-3 font-medium text-[#86909c]">进度</th>
                  <th className="text-right px-5 py-3 font-medium text-[#86909c]">成功/失败</th>
                  <th className="text-right px-5 py-3 font-medium text-[#86909c]">创建时间</th>
                  <th className="text-center px-5 py-3 font-medium text-[#86909c]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f2f3f5]">
                {tasks.map((task) => {
                  const statusInfo = STATUS_MAP[task.status] || STATUS_MAP.PENDING;
                  const progress = task.total_rows > 0
                    ? Math.round((task.processed_rows / task.total_rows) * 100)
                    : 0;

                  return (
                    <tr key={task.task_id} className="hover:bg-[#fafbfc] transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-medium text-[#1d2129] truncate max-w-[200px]">
                          {task.file_name}
                        </div>
                        <div className="text-xs text-[#c9cdd4] mt-0.5">{task.task_id}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-24 h-2 bg-[#e5e6eb] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#0fc6c2] rounded-full transition-all duration-500"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-[#86909c] min-w-[80px]">
                            {task.processed_rows} / {task.total_rows}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="text-[#00b42a]">{task.success_rows}</span>
                        <span className="text-[#c9cdd4] mx-1">/</span>
                        <span className={task.failed_rows > 0 ? "text-[#f53f3f]" : "text-[#86909c]"}>
                          {task.failed_rows}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right text-[#86909c]">
                        {new Date(task.created_at).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <Link
                          href={`/import-tasks/${task.task_id}`}
                          className="text-[#0fc6c2] hover:underline text-sm"
                        >
                          详情
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
