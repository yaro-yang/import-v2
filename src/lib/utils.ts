// 工具函数

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// 格式化时间
export function formatTime(ms: number): string {
  if (ms < 1000) return ms.toFixed(0) + "ms";
  return (ms / 1000).toFixed(2) + "s";
}

// 格式化日期
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 生成唯一 ID
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 校验手机号
export function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()（）]/g, "");
  return /^1[3-9]\d{9}$/.test(cleaned);
}

// 校验正整数
export function isPositiveNumber(value: number): boolean {
  return !isNaN(value) && value > 0;
}

// 截断文本
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

// 类名合并
export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// 导出 Excel
export function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  filename: string
) {
  // 动态导入 xlsx
  import("xlsx").then((XLSX) => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
    XLSX.writeFile(workbook, filename);
  });
}
