import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

// 统计小方块（带 icon + 标签 + 数值）
export function StatBlock({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  tone?: "default" | "primary";
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
          tone === "primary"
            ? "bg-[#e8fafa] text-[#0fc6c2]"
            : "bg-[#f7f8fa] text-[#4e5969]"
        )}
      >
        {icon}
      </div>
      <div>
        <p className="text-[11px] text-[#86909c] leading-tight mb-0.5">{label}</p>
        <p
          className={cn(
            "text-2xl font-bold tabular-nums leading-none",
            tone === "primary" ? "text-[#0bada9]" : "text-[#1d2129]"
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

export function Divider() {
  return <div className="w-px h-8 bg-[#e5e6eb] hidden sm:block" />;
}

// 状态点：已提交 / 草稿 / 错误
export function StatusDot({
  status,
}: {
  status: "draft" | "submitted" | "error";
}) {
  const config = {
    submitted: { color: "#00b42a", label: "已提交" },
    draft: { color: "#86909c", label: "草稿" },
    error: { color: "#cf1322", label: "有错误" },
  }[status];
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{
        backgroundColor: config.color,
        boxShadow: `0 0 0 3px ${config.color}1A`,
      }}
      title={config.label}
    />
  );
}
