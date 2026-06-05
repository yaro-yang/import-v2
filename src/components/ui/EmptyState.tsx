"use client";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon = "📭",
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="text-5xl mb-4 opacity-60">{icon}</div>
      <h3 className="text-lg font-semibold text-[#1d2129] mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-[#86909c] mb-6 text-center max-w-md">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
