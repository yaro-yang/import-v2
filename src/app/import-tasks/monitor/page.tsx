"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface MonitorSummary {
  throughput_5min: Array<{ minute: string; rows: number }>;
  queue_depth: { pending_batches: number; pending_rows: number; alert: string };
  stage_stats: {
    parse: { p50: number; p95: number; p99: number };
    rule: { p50: number; p95: number; p99: number };
    validate: { p50: number; p95: number; p99: number };
    insert: { p50: number; p95: number; p99: number };
  };
  error_distribution: Array<{ error_code: string; count: number }>;
  recent_tasks: Array<{
    task_id: string;
    file_name: string;
    status: string;
    total_rows: number;
    success_rows: number;
    failed_rows: number;
    created_at: string;
  }>;
}

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

const STAGE_COLORS = ["#0fc6c2", "#f7ba1e", "#165dff", "#f53f3f"];

export default function MonitorPage() {
  const [data, setData] = useState<MonitorSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/import-monitor/summary");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("获取监控数据失败:", err);
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
      <div className="flex items-center justify-center py-20">
        <div className="text-[#86909c]">加载中...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20 text-[#86909c]">暂无监控数据</div>
    );
  }

  // 找出最大吞吐量作为柱状图高度基准
  const maxThroughput = Math.max(...data.throughput_5min.map((t) => t.rows), 1);
  const maxErrorCount = Math.max(...data.error_distribution.map((e) => e.count), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1d2129]">导入监控看板</h1>
          <p className="text-sm text-[#86909c] mt-1">
            实时吞吐、队列积压、阶段耗时、错误分布
          </p>
        </div>
        <Link href="/import-tasks" className="text-sm text-[#0fc6c2] hover:underline">
          ← 返回任务列表
        </Link>
      </div>

      {/* 1. 实时吞吐量 + 队列积压 */}
      <div className="grid grid-cols-2 gap-6">
        {/* 吞吐量 */}
        <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
          <h2 className="text-base font-semibold text-[#1d2129] mb-4">实时吞吐量 (行/分钟)</h2>
          <div className="flex items-end gap-2 h-32">
            {data.throughput_5min.length === 0 ? (
              <div className="text-sm text-[#c9cdd4] w-full text-center self-center">暂无数据</div>
            ) : (
              data.throughput_5min.map((item, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-[#86909c]">{item.rows}</span>
                  <div
                    className="w-full bg-[#0fc6c2] rounded-t"
                    style={{
                      height: `${(item.rows / maxThroughput) * 100}%`,
                      minHeight: 4,
                      opacity: 0.7 + (i / data.throughput_5min.length) * 0.3,
                    }}
                  />
                  <span className="text-xs text-[#c9cdd4]">
                    {new Date(item.minute).getMinutes()}分
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 队列积压 */}
        <div className={`bg-white rounded-xl shadow-sm border p-6 ${
          data.queue_depth.alert === "red" ? "border-red-300" :
          data.queue_depth.alert === "orange" ? "border-orange-300" :
          "border-[#e5e6eb]"
        }`}>
          <h2 className="text-base font-semibold text-[#1d2129] mb-4">队列积压</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#86909c]">待处理批次</span>
              <span className="text-2xl font-bold text-[#1d2129]">
                {data.queue_depth.pending_batches}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#86909c]">待处理行数</span>
              <span className={`text-2xl font-bold ${
                data.queue_depth.pending_rows > 5000 ? "text-[#f53f3f]" : "text-[#1d2129]"
              }`}>
                {data.queue_depth.pending_rows.toLocaleString()}
              </span>
            </div>
            {data.queue_depth.alert === "orange" && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-700">
                ⚠️ 队列积压超过 5,000 行
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. 阶段耗时分布 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
        <h2 className="text-base font-semibold text-[#1d2129] mb-4">阶段耗时分布 (ms)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#fafbfc] border-b border-[#e5e6eb]">
                <th className="text-left px-4 py-2.5 font-medium text-[#86909c]">阶段</th>
                <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">P50</th>
                <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">P95</th>
                <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">P99</th>
                <th className="px-4 py-2.5 font-medium text-[#86909c]">分布</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f2f3f5]">
              {[
                { name: "解析", stats: data.stage_stats.parse, color: STAGE_COLORS[0] },
                { name: "规则", stats: data.stage_stats.rule, color: STAGE_COLORS[1] },
                { name: "校验", stats: data.stage_stats.validate, color: STAGE_COLORS[2] },
                { name: "写入", stats: data.stage_stats.insert, color: STAGE_COLORS[3] },
              ].map((stage) => (
                <tr key={stage.name}>
                  <td className="px-4 py-3 font-medium">{stage.name}</td>
                  <td className="px-4 py-3 text-right">{Math.round(stage.stats.p50)}</td>
                  <td className="px-4 py-3 text-right">{Math.round(stage.stats.p95)}</td>
                  <td className="px-4 py-3 text-right">{Math.round(stage.stats.p99)}</td>
                  <td className="px-4 py-3">
                    <div className="w-full h-2 bg-[#f2f3f5] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min((stage.stats.p95 / 5000) * 100, 100)}%`,
                          backgroundColor: stage.color,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. 错误类型分布 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
        <h2 className="text-base font-semibold text-[#1d2129] mb-4">错误类型分布</h2>
        {data.error_distribution.length === 0 ? (
          <div className="text-center py-8 text-[#c9cdd4]">暂无错误数据</div>
        ) : (
          <div className="space-y-3">
            {data.error_distribution.map((item) => (
              <div key={item.error_code} className="flex items-center gap-4">
                <span className="w-20 text-sm font-medium text-[#1d2129]">
                  {item.error_code}
                </span>
                <span className="w-24 text-xs text-[#86909c]">
                  {ERROR_CODE_MAP[item.error_code] || item.error_code}
                </span>
                <div className="flex-1 h-5 bg-[#f2f3f5] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#f53f3f] rounded-full transition-all"
                    style={{ width: `${(item.count / maxErrorCount) * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right text-sm font-medium text-[#1d2129]">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. 最近任务 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e5e6eb] p-6">
        <h2 className="text-base font-semibold text-[#1d2129] mb-4">最近任务</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#fafbfc] border-b border-[#e5e6eb]">
                <th className="text-left px-4 py-2.5 font-medium text-[#86909c]">任务</th>
                <th className="text-left px-4 py-2.5 font-medium text-[#86909c]">状态</th>
                <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">总行</th>
                <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">成功</th>
                <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">失败</th>
                <th className="text-right px-4 py-2.5 font-medium text-[#86909c]">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f2f3f5]">
              {data.recent_tasks.map((task) => (
                <tr key={task.task_id} className="hover:bg-[#fafbfc]">
                  <td className="px-4 py-3">
                    <Link href={`/import-tasks/${task.task_id}`} className="text-[#0fc6c2] hover:underline">
                      {task.file_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      task.status === "COMPLETED" ? "bg-green-100 text-green-700" :
                      task.status === "PARTIAL_SUCCESS" ? "bg-orange-100 text-orange-700" :
                      task.status === "PROCESSING" ? "bg-blue-100 text-blue-700" :
                      task.status === "FAILED" ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{task.total_rows.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-[#00b42a]">{task.success_rows.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-[#f53f3f]">{task.failed_rows.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-[#86909c] text-xs">
                    {new Date(task.created_at).toLocaleString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
