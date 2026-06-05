"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { OrderItem, ValidationError } from "@/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

interface DataPreviewTableProps {
  orders: OrderItem[];
  onUpdateOrder: (id: string, field: string, value: string) => void;
  onDeleteOrder: (id: string) => void;
  onAddRow: () => void;
  errors: ValidationError[];
}

const columns = [
  { key: "externalCode", label: "外部编码", width: 130 },
  { key: "storeName", label: "收货门店", width: 160 },
  { key: "recipientName", label: "收件人", width: 100 },
  { key: "recipientPhone", label: "电话", width: 130 },
  { key: "recipientAddress", label: "地址", width: 200 },
  { key: "skuCode", label: "SKU编码", width: 120, required: true },
  { key: "skuName", label: "SKU名称", width: 150, required: true },
  { key: "skuQuantity", label: "数量", width: 80, required: true },
  { key: "skuSpec", label: "规格型号", width: 120 },
  { key: "remark", label: "备注", width: 150 },
];

export function DataPreviewTable({
  orders,
  onUpdateOrder,
  onDeleteOrder,
  onAddRow,
  errors,
}: DataPreviewTableProps) {
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: string;
  } | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  // 虚拟列表
  const rowVirtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  // 错误映射
  const errorMap = useMemo(() => {
    const map = new Map<string, ValidationError[]>();
    for (const err of errors) {
      // 用 row index 匹配 order
      const key = `row_${err.row}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(err);
    }
    return map;
  }, [errors]);

  const getOrderErrors = (order: OrderItem): ValidationError[] => {
    if (order.errors && order.errors.length > 0) return order.errors;
    const key = `row_${order.sourceRow}`;
    return errorMap.get(key) || [];
  };

  const isFieldError = (order: OrderItem, field: string): boolean => {
    const orderErrors = getOrderErrors(order);
    return orderErrors.some((e) => e.field === field);
  };

  const handleCellClick = (id: string, field: string) => {
    setEditingCell({ id, field });
  };

  const handleCellChange = (
    id: string,
    field: string,
    value: string
  ) => {
    onUpdateOrder(id, field, value);
  };

  const handleCellBlur = () => {
    setEditingCell(null);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    id: string,
    field: string,
    currentIndex: number
  ) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const currentColIndex = columns.findIndex((c) => c.key === field);
      const nextColIndex = e.shiftKey
        ? currentColIndex - 1
        : currentColIndex + 1;

      if (nextColIndex >= 0 && nextColIndex < columns.length) {
        setEditingCell({ id, field: columns[nextColIndex].key });
      } else if (e.key === "Tab" && !e.shiftKey) {
        // 切换到下一行第一列
        const nextOrder = orders[currentIndex + 1];
        if (nextOrder) {
          setEditingCell({ id: nextOrder.id, field: columns[0].key });
        }
      } else if (e.shiftKey && currentIndex > 0) {
        const prevOrder = orders[currentIndex - 1];
        setEditingCell({
          id: prevOrder.id,
          field: columns[columns.length - 1].key,
        });
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-[#4e5969]">
          共 <span className="font-semibold text-[#1d2129]">{orders.length}</span> 条数据
          {errors.length > 0 && (
            <span className="ml-2 text-[#cf1322]">
              · {errors.length} 个错误
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onAddRow}
            className="px-3 py-1.5 text-xs font-medium text-[#0fc6c2] bg-[#e8fafa] rounded-lg hover:bg-[#d0f5f5] transition-colors"
          >
            + 新增行
          </button>
        </div>
      </div>

      {/* 表格容器 */}
      <div
        ref={parentRef}
        className="border border-[#e5e6eb] rounded-xl overflow-auto bg-white"
        style={{ height: "500px" }}
      >
        {/* 表头 */}
        <div className="sticky top-0 z-10 flex bg-[#e8fafa] border-b border-[#d0e8e8] min-w-max">
          <div className="flex-shrink-0 w-12 px-2 py-2.5 text-xs font-semibold text-[#0b6e6e] text-center border-r border-[#d0e8e8]">
            #
          </div>
          {columns.map((col) => (
            <div
              key={col.key}
              className="flex-shrink-0 px-3 py-2.5 text-xs font-semibold text-[#0b6e6e] border-r border-[#d0e8e8]"
              style={{ width: col.width }}
            >
              {col.label}
              {col.required && (
                <span className="text-[#cf1322] ml-0.5">*</span>
              )}
            </div>
          ))}
          <div className="flex-shrink-0 w-16 px-2 py-2.5 text-xs font-semibold text-[#0b6e6e] text-center">
            操作
          </div>
        </div>

        {/* 虚拟列表行 */}
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const order = orders[virtualRow.index];
            const orderErrors = getOrderErrors(order);
            const hasError = orderErrors.length > 0;

            return (
              <div
                key={order.id}
                className={cn(
                  "absolute top-0 left-0 w-full flex min-w-max border-b border-[#f2f3f5] hover:bg-[#fafbfc] transition-colors",
                  hasError && "bg-[#fff7e8]/50"
                )}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {/* 行号 */}
                <div
                  className={cn(
                    "flex-shrink-0 w-12 px-2 py-2.5 text-xs text-center border-r border-[#f2f3f5]",
                    hasError ? "text-[#cf1322]" : "text-[#86909c]"
                  )}
                >
                  {virtualRow.index + 1}
                  {hasError && (
                    <span className="inline-block w-1.5 h-1.5 bg-[#cf1322] rounded-full ml-1" />
                  )}
                </div>

                {/* 数据列 */}
                {columns.map((col) => {
                  const isEditing =
                    editingCell?.id === order.id &&
                    editingCell?.field === col.key;
                  const value = String(
                    (order as unknown as Record<string, unknown>)[col.key] ?? ""
                  );
                  const hasFieldError = isFieldError(order, col.key);

                  return (
                    <div
                      key={col.key}
                      className={cn(
                        "flex-shrink-0 px-3 py-2.5 text-sm border-r border-[#f2f3f5] cursor-pointer",
                        hasFieldError && "bg-[#fff1f0]"
                      )}
                      style={{ width: col.width }}
                      onClick={() => handleCellClick(order.id, col.key)}
                    >
                      {isEditing ? (
                        <input
                          type={col.key === "skuQuantity" ? "number" : "text"}
                          value={value}
                          onChange={(e) =>
                            handleCellChange(order.id, col.key, e.target.value)
                          }
                          onBlur={handleCellBlur}
                          onKeyDown={(e) =>
                            handleKeyDown(e, order.id, col.key, virtualRow.index)
                          }
                          className={cn(
                            "w-full px-1 py-0.5 text-sm border rounded outline-none",
                            hasFieldError
                              ? "border-[#cf1322] bg-[#fff1f0]"
                              : "border-[#0fc6c2] bg-white"
                          )}
                          autoFocus
                        />
                      ) : (
                        <span
                          className={cn(
                            "block truncate",
                            hasFieldError && "text-[#cf1322] font-medium",
                            !value && "text-[#c9cdd4] italic"
                          )}
                          title={value}
                        >
                          {value || "—"}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* 操作列 */}
                <div className="flex-shrink-0 w-16 px-2 py-2.5 flex items-center justify-center">
                  <button
                    onClick={() => onDeleteOrder(order.id)}
                    className="px-2 py-1 text-xs text-[#86909c] hover:text-[#cf1322] hover:bg-[#fff1f0] rounded transition-colors"
                    title="删除行"
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 错误汇总 */}
      {errors.length > 0 && (
        <div className="mt-3 p-3 bg-[#fff7e8] border border-[#ffe4ba] rounded-lg">
          <p className="text-sm font-semibold text-[#d97b00] mb-2">
            ⚠️ 校验发现 {errors.length} 个问题：
          </p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {errors.map((err, i) => (
              <p key={i} className="text-xs text-[#d97b00]">
                第 {err.row} 行 · {err.field}: {err.message}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
