"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "导入下单", icon: "📦" },
  { href: "/rules", label: "解析规则", icon: "⚙️" },
  { href: "/history", label: "已导入运单", icon: "📋" },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-[#e5e6eb] shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-lg bg-[#0fc6c2] flex items-center justify-center text-white font-bold text-lg group-hover:bg-[#0bada9] transition-colors">
              U
            </div>
            <div>
              <span className="text-lg font-bold text-[#1d2129]">万能导入 V2</span>
              <span className="hidden sm:inline text-xs text-[#86909c] ml-2">
                智能多格式批量下单
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-[#e8fafa] text-[#0fc6c2]"
                      : "text-[#4e5969] hover:bg-[#f7f8fa] hover:text-[#1d2129]"
                  }`}
                >
                  <span>{item.icon}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
