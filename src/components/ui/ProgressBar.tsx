"use client";

interface ProgressBarProps {
  progress: number;            // 0-100
  label?: string;
  showPercent?: boolean;
  showCount?: boolean;         // 是否显示 "X / Y" 条数
  processed?: number;          // 已处理条数
  total?: number;              // 总条数
  variant?: "primary" | "success" | "warning" | "danger";
}

const variantColors = {
  primary: "bg-[#0fc6c2]",
  success: "bg-[#28a745]",
  warning: "bg-[#e6a23c]",
  danger: "bg-[#cf1322]",
};

export function ProgressBar({
  progress,
  label,
  showPercent = true,
  showCount = false,
  processed,
  total,
  variant = "primary",
}: ProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className="w-full">
      {(label || showPercent || showCount) && (
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {label && (
              <span className="text-sm text-[#4e5969] font-medium truncate">
                {label}
              </span>
            )}
            {showCount && processed !== undefined && total !== undefined && total > 0 && (
              <span className="text-xs text-[#86909c] font-mono whitespace-nowrap">
                {processed.toLocaleString()} / {total.toLocaleString()} 条
              </span>
            )}
          </div>
          {showPercent && (
            <span className="text-sm text-[#0fc6c2] font-semibold tabular-nums">
              {clampedProgress.toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <div className="w-full h-2.5 bg-[#f2f3f5] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${variantColors[variant]} ${
            clampedProgress < 100 ? "progress-striped" : ""
          }`}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
    </div>
  );
}
