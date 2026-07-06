"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const v3NavItems = [
  { href: "/v3/scan", label: "扫描品控", icon: "scan" },
  { href: "/v3/tickets", label: "工单管理", icon: "ticket" },
  { href: "/v3/tickets/new", label: "异常上报", icon: "report" },
  { href: "/v3/approvals", label: "审批中心", icon: "approve" },
  { href: "/v3/settings", label: "规则配置", icon: "settings" },
  { href: "/v3/monitor", label: "同步监控", icon: "monitor" },
];

function V3Icon({ type }: { type: string }) {
  switch (type) {
    case "scan":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </svg>
      );
    case "ticket":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case "report":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      );
    case "approve":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "settings":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "monitor":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    default:
      return null;
  }
}

export default function V3Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <>
      {/* V3 侧边栏 */}
      <aside
        className={`fixed left-[240px] top-[56px] bottom-0 w-[200px] bg-white border-r border-[#e5e6eb] z-30 flex flex-col lg:translate-x-0 ${
          sidebarOpen ? "open" : ""
        }`}
        style={{
          boxShadow: "2px 0 8px rgba(0,0,0,0.06)",
        }}
      >
        <div className="px-4 py-4 border-b border-[#f2f3f5]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#0fc6c2] flex items-center justify-center">
              <span className="text-white font-bold text-[10px]">V3</span>
            </div>
            <span className="text-[#1d2129] font-semibold text-sm">运单全流程</span>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {v3NavItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-200 h-10 px-3 ${
                  isActive
                    ? "bg-[#e8fafa] text-[#0fc6c2]"
                    : "text-[#4e5969] hover:bg-[#f7f8fa] hover:text-[#1d2129]"
                }`}
              >
                <V3Icon type={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-[#f2f3f5]">
          <p className="text-xs text-[#86909c]">V3 运单全流程管理系统</p>
        </div>
      </aside>

      {/* 遮罩（小屏下） */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 主内容区（根布局已处理 marginLeft:240 + marginTop:56，此处只需加 V3 侧边栏的 200px） */}
      <div
        className="min-h-screen"
        style={{
          paddingLeft: 216,  // 200(V3 sidebar) + 16(padding)
          paddingRight: 16,
          paddingTop: 16,
          paddingBottom: 24,
        }}
      >
        <div className="w-full max-w-[1200px]">{children}</div>
      </div>
    </>
  );
}
