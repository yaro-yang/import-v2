"use client";

interface ProgressBarProps {
  progress: number;
  label?: string;
  showPercent?: boolean;
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
  variant = "primary",
}: ProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className="w-full">
      {(label || showPercent) && (
        <div className="flex justify-between items-center mb-2">
          {label && (
            <span className="text-sm text-[#4e5969] font-medium">{label}</span>
          )}
          {showPercent && (
            <span className="text-sm text-[#0fc6c2] font-semibold">
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
