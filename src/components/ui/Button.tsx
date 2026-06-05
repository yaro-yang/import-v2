"use client";

import { Spinner } from "./Spinner";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantClasses = {
  primary:
    "bg-[#0fc6c2] text-white hover:bg-[#0bada9] active:bg-[#0a9e9a] shadow-sm",
  secondary:
    "bg-[#f7f8fa] text-[#4e5969] hover:bg-[#e5e6eb] active:bg-[#d9dadd] border border-[#e5e6eb]",
  danger:
    "bg-[#cf1322] text-white hover:bg-[#b0101c] active:bg-[#9a0e18] shadow-sm",
  ghost:
    "bg-transparent text-[#4e5969] hover:bg-[#f7f8fa] active:bg-[#e5e6eb]",
};

const sizeClasses = {
  sm: "px-3 py-1.5 text-xs rounded-md gap-1.5",
  md: "px-4 py-2 text-sm rounded-lg gap-2",
  lg: "px-6 py-2.5 text-base rounded-lg gap-2",
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
      className={`inline-flex items-center justify-center font-medium transition-all duration-200 
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : icon ? (
        <span className="flex-shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
