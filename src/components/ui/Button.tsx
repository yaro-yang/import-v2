"use client";

import { Spinner } from "./Spinner";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "secondary" | "danger" | "ghost" | "link";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantClasses = {
  primary:
    "bg-[#0fc6c2] text-white hover:bg-[#0bada9] active:bg-[#089e98] shadow-sm",
  outline:
    "bg-white text-[#0fc6c2] border border-[#0fc6c2] hover:bg-[#e8fafa]",
  secondary:
    "bg-white text-[#4e5969] hover:bg-[#f7f8fa] active:bg-[#e5e6eb] border border-[#e5e6eb]",
  danger:
    "bg-[#cf1322] text-white hover:bg-[#b0101c] active:bg-[#9a0e18] shadow-sm",
  ghost:
    "bg-transparent text-[#4e5969] hover:bg-[#f2f3f5] active:bg-[#e5e6eb]",
  link:
    "bg-transparent text-[#0fc6c2] hover:text-[#0bada9] hover:underline px-1",
};

const sizeClasses = {
  sm: "px-6 py-2.5 text-sm font-medium rounded-sm gap-1.5",
  md: "px-7 py-3 text-base font-medium rounded-sm gap-2",
  lg: "px-8 py-3.5 text-lg font-medium rounded-sm gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`relative inline-flex items-center justify-center font-medium transition-all duration-200 select-none
        disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none
        ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <Spinner size="sm" />
      )}
      {!loading && icon && (
        <span className="flex-shrink-0">{icon}</span>
      )}
      {children}
    </button>
  );
}
