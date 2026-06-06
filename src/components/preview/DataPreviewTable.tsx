"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { OrderItem, ValidationError, TEMPERATURE_LEVELS } from "@/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import {
  validateOrders,
  findBatchDuplicates,
} from "@/lib/validation";

interface DataPreviewTableProps {
  orders: OrderItem[];
  onUpdateOrder: (id: string, field: string, value: string) => void;
  onDeleteOrder: (id: string) => void;
  onAddRow: () => void;
  errors: ValidationError[];
  onValidationChange?: (result: {
    errors: ValidationError[];
    errorOrderIds: Set<string>;
    duplicateCodes: string[];
  }) => void;
}

// 列定义 - 类 Excel 表格
// 顺序：身份信息 → 收货信息 → SKU 信息 → 物理属性 → 备注
const columns: Array<{
  key: string;
  label: string;
  width: number;
  required?: boolean;
  type?: "text" | "number";
  options?: readonly string[];
}> = [
  { key: "externalCode", label: "外部编码", width: 130 },
  { key: "storeName", label: "收货门店", width: 160 },
  { key: "recipientName", label: "收件人", width: 100 },
  { key: "recipientPhone", label: "电话", width: 130 },
  { key: "recipientAddress", label: "地址", width: 200 },
  { key: "skuCode", label: "SKU编码", width: 120, required: true },
  { key: "skuName", label: "SKU名称", width: 150, required: true },
  { key: "skuQuantity", label: "数量", width: 80, required: true, type: "number" },
  { key: "skuSpec", label: "规格型号", width: 120 },
  { key: "weight", label: "重量(kg)", width: 100, type: "number" },
  { key: "temperatureLevel", label: "温层", width: 90, options: TEMPERATURE_LEVELS },
  { key: "remark", label: "备注", width: 150 },
];

export function DataPreviewTable({
  orders,
  onUpdateOrder,
  onDeleteOrder,
  onAddRow,
  errors: externalErrors = [],
  onValidationChange,
}: DataPreviewTableProps) {
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: string;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  // 实时校验 + 错误映射
  const { errors, errorFieldMap, duplicateCodes, duplicateOrderIds } = useMemo((): {
    errors: ValidationError[];
    errorFieldMap: Map<string, Set<string>>;
    duplicateCodes: string[];
    duplicateOrderIds: Set<string>;
  } => {
    // 1. 字段级校验
    const { errors: fieldErrors } = validateOrders(orders);

    // 把错误按 order.id 索引（用于单元格级标红）
    const errorFieldMap = new Map<string, Set<string>>();
    for (const err of fieldErrors) {
      const ordersAtRow = orders.filter((o) => (o.sourceRow || 0) === err.row);
      for (const o of ordersAtRow) {
        if (!errorFieldMap.has(o.id)) errorFieldMap.set(o.id, new Set());
        errorFieldMap.get(o.id)!.add(err.field);
      }
    }

    // 2. 批次内重复检测（复合键：调拨单号+门店+SKU）
    // 调拨单场景：同一调拨单号下 9 个 SKU 分发到 3 个不同门店 → 不会误报
    // 出库单场景：缺少 storeName 时退化为 code|skuCode → 等同于按 SKU 粒度查重
    const batchDup = findBatchDuplicates(orders);
    const duplicateKeys: string[] = [];
    const duplicateOrderIds = new Set<string>();
    for (const [key, indices] of batchDup) {
      // 解析复合键：[code, store, sku]
      const [code, store, sku] = key.split("|");
      duplicateKeys.push(code);
      for (const i of indices) {
        const order = orders[i];
        if (order) duplicateOrderIds.add(order.id);
      }
      for (const i of indices) {
        const order = orders[i];
        if (order) {
          const id = order.id;
          if (!errorFieldMap.has(id)) errorFieldMap.set(id, new Set());
          errorFieldMap.get(id)!.add("externalCode");
          // 描述性消息：让用户看清楚是哪个组合重复了
          const desc =
            store === "__no_store__"
              ? `${code} / SKU:${sku}`
              : `${code} / ${store} / SKU:${sku}`;
          fieldErrors.push({
            row: order.sourceRow || 0,
            field: "externalCode",
            message: `本批次内重复（出现 ${indices.length} 次）：${desc}`,
            severity: "error",
          });
        }
      }
    }

    // 3. 合并外部传入的错误（解析阶段 + DB 重复检测）— 标记对应单元格
    const allErrors: ValidationError[] = [...fieldErrors];
    for (const err of externalErrors) {
      const ordersAtRow = orders.filter((o) => (o.sourceRow || 0) === err.row);
      for (const o of ordersAtRow) {
        if (!errorFieldMap.has(o.id)) errorFieldMap.set(o.id, new Set());
        errorFieldMap.get(o.id)!.add(err.field);
      }
      allErrors.push(err);
    }

    return {
      errors: allErrors,
      errorFieldMap,
      duplicateCodes: duplicateKeys,
      duplicateOrderIds,
    };
  }, [orders, externalErrors]);

  // 把校验结果回传给父组件
  useEffect(() => {
    onValidationChange?.({ errors, errorOrderIds: new Set(errorFieldMap.keys()), duplicateCodes });
  }, [errors, errorFieldMap, duplicateCodes, onValidationChange]);

  const rowVirtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const isFieldError = (orderId: string, field: string): boolean => {
    const fields = errorFieldMap.get(orderId);
    if (!fields) return false;
    // 收货信息组（storeName/recipientName/recipientPhone/recipientAddress）共一个错误
    if (field === "storeName" || field === "recipientName" || field === "recipientPhone" || field === "recipientAddress") {
      return fields.has("收货信息") || fields.has(field);
    }
    return fields.has(field);
  };

  const isWholeRowError = (orderId: string): boolean => errorFieldMap.has(orderId);
  const isDuplicateRow = (orderId: string): boolean => duplicateOrderIds.has(orderId);

  const handleCellClick = (id: string, field: string) => {
    setEditingCell({ id, field });
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
    } else if (e.key === "Escape") {
      handleCellBlur();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-sm text-[#4e5969] flex items-center gap-3 flex-wrap">
          <span>
            共 <span className="font-semibold text-[#1d2129]">{orders.length}</span> 条数据
          </span>
          {errorFieldMap.size > 0 && (
            <span className="text-[#cf1322] flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 bg-[#cf1322] rounded-full" />
              {errorFieldMap.size} 行有错
            </span>
          )}
          {duplicateCodes.length > 0 && (
            <span className="text-[#d97b00] flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 bg-[#d97b00] rounded-full" />
              本批次 {duplicateCodes.length} 个外部编码重复
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onAddRow}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          新增行
        </Button>
      </div>

      {/* 表格容器 - 类 Excel：粘性表头 + 横向滚动 */}
      <div
        ref={parentRef}
        className="border border-[#e5e6eb] rounded-xl overflow-auto"
        style={{ height: "480px", maxHeight: "clamp(320px, 60vh, 480px)" }}
      >
        {/* 表头 - 固定吸顶 */}
        <div className="sticky top-0 z-10 flex bg-[#fafbfc] border-b border-[#e5e6eb] min-w-max shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <div className="flex-shrink-0 w-10 lg:w-12 px-1 lg:px-2 py-2.5 text-xs font-semibold text-[#4e5969] text-center border-r border-[#e5e6eb] sticky left-0 bg-[#fafbfc] z-20">
            #
          </div>
          {columns.map((col) => (
            <div
              key={col.key}
              className="flex-shrink-0 px-2.5 lg:px-3 py-2.5 text-xs font-semibold text-[#4e5969] border-r border-[#e5e6eb] whitespace-nowrap"
              style={{ width: col.width }}
            >
              {col.label}
              {col.required && (
                <span className="text-[#cf1322] ml-0.5">*</span>
              )}
            </div>
          ))}
          <div className="flex-shrink-0 w-14 lg:w-16 px-2 py-2.5 text-xs font-semibold text-[#4e5969] text-center sticky right-0 bg-[#fafbfc] z-20 shadow-[-2px_0_4px_rgba(0,0,0,0.04)]">
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
            const rowHasError = isWholeRowError(order.id);
            const isDup = isDuplicateRow(order.id);

            return (
              <div
                key={order.id}
                className={cn(
                  "absolute top-0 left-0 w-full flex min-w-max border-b border-[#f2f3f5] hover:bg-[#fafbfc] transition-colors",
                  rowHasError && "bg-[#fff7e8]/40",
                  isDup && "bg-[#fff1f0]/70 ring-1 ring-inset ring-[#ffccc7]"
                )}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {/* 行号 - 粘性左列 */}
                <div
                  className={cn(
                    "flex-shrink-0 w-10 lg:w-12 px-1 lg:px-2 py-2.5 text-xs text-center border-r border-[#f2f3f5] sticky left-0 z-10",
                    rowHasError
                      ? "text-[#cf1322] bg-[#fff7e8]/80"
                      : isDup
                        ? "text-[#cf1322] bg-[#fff1f0]/80"
                        : "text-[#86909c] bg-inherit"
                  )}
                >
                  {virtualRow.index + 1}
                  {(rowHasError || isDup) && (
                    <span
                      className={cn(
                        "inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle",
                        isDup ? "bg-[#cf1322]" : "bg-[#cf1322]"
                      )}
                    />
                  )}
                </div>

                {/* 数据列 */}
                {columns.map((col) => {
                  const isEditing =
                    editingCell?.id === order.id &&
                    editingCell?.field === col.key;
                  const value = (order as unknown as Record<string, unknown>)[col.key];
                  const displayValue = value === undefined || value === null ? "" : String(value);
                  const hasFieldError = isFieldError(order.id, col.key);

                  return (
                    <div
                      key={col.key}
                      className={cn(
                        "flex-shrink-0 px-2.5 lg:px-3 py-2.5 text-sm border-r border-[#f2f3f5] cursor-pointer relative group",
                        hasFieldError && "bg-[#fff1f0]"
                      )}
                      style={{ width: col.width }}
                      onClick={() => handleCellClick(order.id, col.key)}
                      title={hasFieldError ? `本单元格有错误：${[...errorFieldMap.get(order.id) || []].join("、")}` : undefined}
                    >
                      {isEditing ? (
                        col.options ? (
                          // 下拉选择（温层）
                          <select
                            value={displayValue}
                            onChange={(e) => onUpdateOrder(order.id, col.key, e.target.value)}
                            onBlur={handleCellBlur}
                            onKeyDown={(e) => handleKeyDown(e, order.id, col.key, virtualRow.index)}
                            className={cn(
                              "w-full px-1.5 py-0.5 text-sm border rounded outline-none bg-white",
                              hasFieldError
                                ? "border-[#cf1322] bg-[#fff1f0]"
                                : "border-[#0fc6c2] focus:ring-1 focus:ring-[#0fc6c2]/20"
                            )}
                            autoFocus
                          >
                            <option value="">—</option>
                            {col.options.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={col.type === "number" ? "number" : "text"}
                            value={displayValue}
                            onChange={(e) => onUpdateOrder(order.id, col.key, e.target.value)}
                            onBlur={handleCellBlur}
                            onKeyDown={(e) => handleKeyDown(e, order.id, col.key, virtualRow.index)}
                            className={cn(
                              "w-full px-1.5 py-0.5 text-sm border rounded outline-none",
                              hasFieldError
                                ? "border-[#cf1322] bg-[#fff1f0]"
                                : "border-[#0fc6c2] bg-white focus:ring-1 focus:ring-[#0fc6c2]/20"
                            )}
                            step={col.type === "number" ? "0.01" : undefined}
                            min={col.type === "number" ? "0" : undefined}
                            autoFocus
                          />
                        )
                      ) : col.options ? (
                        <span
                          className={cn(
                            "block truncate",
                            hasFieldError && "text-[#cf1322] font-medium",
                            !displayValue && "text-[#c9cdd4] italic"
                          )}
                          title={displayValue}
                        >
                          {displayValue || "—"}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "block truncate",
                            hasFieldError && "text-[#cf1322] font-medium",
                            !displayValue && "text-[#c9cdd4] italic"
                          )}
                          title={displayValue}
                        >
                          {displayValue || "—"}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* 操作列 - 粘性右列 */}
                <div className="flex-shrink-0 w-14 lg:w-16 px-2 py-2.5 flex items-center justify-center sticky right-0 z-10 bg-inherit shadow-[-2px_0_4px_rgba(0,0,0,0.04)]">
                  <button
                    onClick={() => onDeleteOrder(order.id)}
                    className="px-2 py-1 text-xs text-[#86909c] hover:text-[#cf1322] hover:bg-[#fff1f0] rounded transition-colors whitespace-nowrap"
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

      {/* 错误汇总 - 全部错误一次性展示 */}
      {errors.length > 0 && (
        <div className="mt-3 p-3 bg-[#fff7e8] border border-[#ffe4ba] rounded-lg max-h-44 overflow-y-auto">
          <p className="text-sm font-medium text-[#d97b00] mb-1.5 flex items-center gap-1.5 sticky top-0 bg-[#fff7e8] py-1 z-10">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            校验发现 {errors.length} 个问题
            {errorFieldMap.size > 0 && (
              <span className="text-xs font-normal text-[#d97b00]/80">
                （共 {errorFieldMap.size} 行）
              </span>
            )}
          </p>
          <div className="space-y-0.5">
            {errors.map((err, i) => {
              const isBatchDup = err.message.includes("本批次内重复");
              return (
                <div
                  key={i}
                  className={cn(
                    "text-xs pl-5 flex items-start gap-2",
                    isBatchDup ? "text-[#cf1322]" : "text-[#d97b00]"
                  )}
                >
                  <span className="font-mono whitespace-nowrap flex-shrink-0">
                    第 {err.row || "?"} 行
                  </span>
                  <span className="text-[#86909c]">·</span>
                  <span className="font-medium flex-shrink-0">
                    {err.field === "收货信息" ? "收货信息" : err.field}
                  </span>
                  <span className="text-[#86909c]">·</span>
                  <span className="flex-1">{err.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
