"use client";

import { useState } from "react";
import Link from "next/link";

interface SearchResult {
  trace_id: string;
  task_id: string;
  event_name: string;
  event_status: string;
  message: string;
  occurred_at: string;
}

export default function TraceSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/import-tasks/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* 头部 */}
      <div>
        <Link href="/import-tasks" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-teal-500 transition-colors mb-3">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回任务列表
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Trace 检索</h1>
        <p className="text-sm text-gray-500 mt-1.5">按 Trace ID、Task ID 或事件名搜索</p>
      </div>

      {/* 搜索框 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="输入 Trace ID、Task ID 或事件名称..."
              className="w-full pl-12 pr-4 py-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 transition-all placeholder:text-gray-300"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-6 py-3 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 rounded-xl hover:from-teal-600 hover:to-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-teal-500/25 flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                搜索中
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                搜索
              </>
            )}
          </button>
        </div>
        <p className="text-xs text-gray-300 mt-3 ml-1">支持模糊搜索，搜索范围：Trace ID、Task ID、事件名称</p>
      </div>

      {/* 结果 */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-2/3 mb-2" />
              <div className="h-3 bg-gray-50 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-50 flex items-center justify-center">
            <svg className="w-7 h-7 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">未找到匹配结果</p>
          <p className="text-gray-300 text-xs mt-1">尝试其他关键词</p>
        </div>
      )}

      {results.length > 0 && (
        <div>
          <p className="text-sm text-gray-400 mb-4">找到 {results.length} 条结果</p>
          <div className="space-y-3">
            {results.map((r, i) => (
              <Link
                key={i}
                href={`/import-tasks/trace/${r.trace_id}`}
                className="block bg-white rounded-2xl border border-gray-100 p-5 hover:border-teal-200 hover:shadow-md transition-all duration-200 group"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${r.event_status === "OK" ? "bg-emerald-50" : "bg-rose-50"}`}>
                    <svg className={`w-5 h-5 ${r.event_status === "OK" ? "text-emerald-500" : "text-rose-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {r.event_status === "OK" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      )}
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-900">
                        {r.event_name.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <span className={`text-xs font-medium ${r.event_status === "OK" ? "text-emerald-500" : "text-rose-500"}`}>
                        {r.event_status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mb-2">{r.message}</p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-mono text-gray-300">{r.trace_id}</span>
                      <span className="text-gray-200">·</span>
                      <span className="font-mono text-gray-300">{r.task_id}</span>
                      <span className="text-gray-200">·</span>
                      <span className="text-gray-400">
                        {new Date(r.occurred_at).toLocaleString("zh-CN", {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-gray-300 group-hover:text-teal-400 transition-colors flex-shrink-0 mt-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
