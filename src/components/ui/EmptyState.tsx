"use client";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 lg:py-16 px-4 animate-fade-in">
      <div className="mb-4">
        {icon || (
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#f7f8fa] to-[#e8e9eb] flex items-center justify-center shadow-sm">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c5ccd3" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
              <line x1="9" y1="13" x2="15" y2="13"/>
              <line x1="9" y1="17" x2="13" y2="17"/>
            </svg>
          </div>
        )}
      </div>
      <h3 className="text-base font-medium text-[#1d2129] mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-[#86909c] mb-5 text-center max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
