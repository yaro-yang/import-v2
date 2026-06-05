"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "导入下单", icon: "import" },
  { href: "/rules", label: "解析规则", icon: "settings" },
  { href: "/history", label: "已导入运单", icon: "list" },
];

function SidebarIcon({ type }: { type: string }) {
  switch (type) {
    case "import":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case "settings":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "list":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      );
    default:
      return null;
  }
}

export function Navigation() {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 点击导航项后关闭侧边栏（小屏下）
  const handleNavClick = () => {
    setSidebarOpen(false);
  };

  // 监听窗口大小变化，大屏时重置 sidebar 状态
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 路由变化时关闭侧边栏
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <>
      {/* 左侧深色导航栏 */}
      <aside
        className={`sidebar-panel fixed left-0 top-0 bottom-0 w-[240px] bg-[#1a2e35] z-50 flex flex-col lg:translate-x-0 ${
          sidebarOpen ? "open" : ""
        }`}
      >
        {/* Logo 区域 */}
        <div className="h-[56px] flex items-center px-6 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-[#0fc6c2] to-[#0bada9] flex items-center justify-center">
              <span className="text-white font-bold text-sm">U</span>
            </div>
            <span className="text-white font-semibold text-lg tracking-wide">万能导入</span>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 py-8 px-4 space-y-5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                className={`relative flex items-center gap-3.5 rounded-lg text-base font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-[#0fc6c2] via-[#0fc6c2]/60 to-transparent text-white shadow-[0_8px_20px_rgba(15,198,194,0.35)]"
                    : "text-[#8faab5] hover:bg-[#22404b] hover:text-white"
                }`}
                style={{
                  paddingLeft: 20,
                  paddingRight: 20,
                  height: 60,
                }}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-10 bg-white rounded-r-full" />
                )}
                <SidebarIcon type={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* 底部版本信息 */}
        <div className="mt-auto px-6 py-4 border-t border-white/10">
          <p className="text-sm text-[#4a9a95]">万能导入 V2</p>
        </div>
      </aside>

      {/* 侧边栏遮罩（小屏下） */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 顶部标题栏 */}
      <header className="top-header fixed left-[240px] right-0 top-0 h-[56px] bg-white border-b border-[#e5e6eb] z-40 flex items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-3">
          {/* 汉堡菜单按钮（小屏下显示） */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden w-8 h-8 flex items-center justify-center rounded text-[#4e5969] hover:bg-[#f2f3f5] transition-colors"
            aria-label="菜单"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {sidebarOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-[#1d2129]">
            {pathname === "/" && "导入下单"}
            {pathname.startsWith("/rules") && "解析规则管理"}
            {pathname.startsWith("/history") && "已导入运单"}
          </h2>
        </div>
        <div className="flex items-center gap-3 lg:gap-4 text-sm text-[#86909c]">
        </div>
      </header>

      {/* 占位：补偿侧边栏和顶栏高度（layout 中已处理） */}
    
    </>
  );
}
