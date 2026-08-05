"use client";

import { useState, useRef, useCallback } from "react";
import { formatFileSize } from "@/lib/utils";

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  maxSize?: number;
  disabled?: boolean;
}

export function FileUploader({
  onFileSelect,
  accept = ".xlsx,.xls,.docx,.pdf",
  maxSize = 50 * 1024 * 1024,
  disabled = false,
}: FileUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): boolean => {
    setError(null);

    if (file.size === 0) {
      setError("文件为空，请选择一个有效的文件");
      return false;
    }

    if (file.size > maxSize) {
      setError(`文件大小超过限制（最大 ${formatFileSize(maxSize)}）`);
      return false;
    }

    const allowedTypes = accept
      .split(",")
      .map((t) => t.trim().replace(".", ""));
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !allowedTypes.includes(ext)) {
      setError(`不支持的文件格式（支持: ${accept}）`);
      return false;
    }

    return true;
  }, [maxSize, accept]);

  const handleFile = useCallback(
    (file: File) => {
      if (validateFile(file)) {
        onFileSelect(file);
      }
    },
    [onFileSelect, validateFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [disabled, handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  return (
    <div className="w-full">
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative border-2 border-dashed rounded-xl p-10 lg:p-16 text-center cursor-pointer
          transition-all duration-200
          ${
            isDragOver
              ? "border-[#0fc6c2] bg-[#e8fafa] scale-[1.01]"
              : "border-[#d0d7de] bg-white hover:border-[#0fc6c2] hover:bg-[#f8fafb]"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
          disabled={disabled}
        />

        <div className="flex flex-col items-center gap-3.5">
          {/* 上传图标 */}
          <div
            className={`w-14 h-14 rounded-xl flex items-center justify-center transition-colors ${
              isDragOver ? "bg-[#0fc6c2] text-white shadow-[0_4px_12px_rgba(15,198,194,0.3)]" : "bg-[#e8fafa] text-[#0fc6c2]"
            }`}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>

          {/* 文字提示 */}
          <div>
            <p className="text-[#1d2129] font-medium text-sm lg:text-base">
              {isDragOver ? "释放文件以上传" : "拖拽文件到此处，或点击上传"}
            </p>
            <p className="text-[#86909c] text-sm mt-1.5">
              支持 Excel (.xlsx/.xls)、Word (.docx)、PDF 格式
            </p>
            <p className="text-[#b5bbc3] text-xs mt-0.5">
              最大文件大小: {formatFileSize(maxSize)}
            </p>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mt-3 p-3 bg-[#fff1f0] border border-[#ffccc7] rounded-lg text-sm text-[#cf1322] animate-fade-in flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
