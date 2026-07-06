"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { ApiSyncLog } from "@/types";

function initV3() {
  return fetch("/api/v3/init").catch(() => {});
}

export default function MonitorPage() {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v3/monitor");
      const data = await res.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch {
      toast.error("获取监控数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initV3().then(() => fetchStats());
    const interval = setInterval(fetchStats, 30000); // 30秒刷新
    return () => clearInterval(interval);
  }, [fetchStats]);

  const recentLogs = (stats?.recentLogs as ApiSyncLog[]) || [];

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1d2129]">同步监控</h1>
          <p className="text-sm text-[#86909c] mt-1">V2接口调用状态与数据同步监控</p>
        </div>
        <button
          onClick={fetchStats}
          className="text-sm border border-[#e5e6eb] rounded-lg px-4 py-1.5 hover:bg-[#f7f8fa] transition-colors"
        >
          刷新
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-[#86909c]">加载中...</p>
        </div>
      ) : (
        <>
          {/* 概览卡片 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-4 card-enhanced">
              <p className="text-xs text-[#86909c] mb-1">V2 健康状态</p>
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${stats?.v2Healthy ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-lg font-semibold text-[#1d2129]">{stats?.v2Healthy ? "正常" : "不可用"}</span>
              </div>
              <p className="text-xs text-[#86909c] mt-1">延迟：{stats?.v2Latency as number || 0}ms</p>
            </div>
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-4 card-enhanced">
              <p className="text-xs text-[#86909c] mb-1">总调用次数</p>
              <p className="text-lg font-semibold text-[#1d2129]">{stats?.totalCalls as number || 0}</p>
            </div>
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-4 card-enhanced">
              <p className="text-xs text-[#86909c] mb-1">成功率</p>
              <p className={`text-lg font-semibold ${(stats?.successRate as number || 0) >= 90 ? "text-green-600" : "text-red-600"}`}>
                {stats?.successRate as number || 0}%
              </p>
            </div>
            <div className="bg-white rounded-xl border border-[#e5e6eb] p-4 card-enhanced">
              <p className="text-xs text-[#86909c] mb-1">最近同步</p>
              <p className="text-sm font-medium text-[#1d2129]">
                {stats?.lastSyncTime ? new Date(stats.lastSyncTime as string).toLocaleString("zh-CN") : "暂无"}
              </p>
            </div>
          </div>

          {/* 调用日志 */}
          <div className="bg-white rounded-xl border border-[#e5e6eb] p-6 card-enhanced">
            <h2 className="text-base font-semibold text-[#1d2129] mb-4">最近接口调用日志</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f7f8fa] border-b border-[#e5e6eb]">
                    <th className="text-left px-3 py-2 font-medium text-[#4e5969] text-xs">时间</th>
                    <th className="text-left px-3 py-2 font-medium text-[#4e5969] text-xs">Request ID</th>
                    <th className="text-left px-3 py-2 font-medium text-[#4e5969] text-xs">接口</th>
                    <th className="text-left px-3 py-2 font-medium text-[#4e5969] text-xs">状态</th>
                    <th className="text-left px-3 py-2 font-medium text-[#4e5969] text-xs">耗时</th>
                    <th className="text-left px-3 py-2 font-medium text-[#4e5969] text-xs">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLogs.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-[#86909c] text-xs">暂无调用日志</td></tr>
                  ) : (
                    recentLogs.map((log) => (
                      <tr key={log.id} className="border-b border-[#f2f3f5]">
                        <td className="px-3 py-2 text-xs text-[#86909c]">
                          {new Date(log.createdAt).toLocaleString("zh-CN")}
                        </td>
                        <td className="px-3 py-2 text-xs text-[#4e5969] font-mono max-w-[200px] truncate">
                          {log.requestId}
                        </td>
                        <td className="px-3 py-2 text-xs text-[#4e5969]">{log.apiName}</td>
                        <td className="px-3 py-2 text-xs">
                          <span className={log.responseStatus ? (log.responseStatus < 400 ? "text-green-600" : "text-red-600") : "text-[#86909c]"}>
                            {log.responseStatus || "N/A"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-[#86909c]">{log.durationMs}ms</td>
                        <td className="px-3 py-2 text-xs">
                          {log.success ? (
                            <span className="text-green-600">✅</span>
                          ) : (
                            <span className="text-red-600" title={log.errorMessage || ""}>❌ {log.errorMessage?.slice(0, 30)}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 降级提示 */}
          {!stats?.v2Healthy && (
            <div className="bg-[#fff7e8] border border-[#ffe4ba] rounded-xl p-4">
              <p className="text-sm font-medium text-[#d97b00]">⚠️ V2 服务不可用</p>
              <p className="text-xs text-[#ba7517] mt-1">
                系统正在使用本地缓存数据（降级模式）。数据来源标注为&ldquo;本地缓存&rdquo;，可能非最新状态。V2服务恢复后将自动同步。
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
