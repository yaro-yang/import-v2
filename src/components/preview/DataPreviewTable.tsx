"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { OrderItem, ValidationError, TEMPERATURE_LEVELS } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { StatBlock, Divider, StatusDot } from "@/components/ui/TableDecorations";
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
  /** 业务模式：outbound（默认）/ transfer（调拨单，启用三级层级预览） */
  mode?: "outbound" | "transfer";
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

// 调拨单模式：9 列（与已导入运单页统一，去掉 weight / temperatureLevel / remark）
const transferColumns: Array<{
  key: string;
  label: string;
  width: number;
  required?: boolean;
  type?: "text" | "number";
  options?: readonly string[];
}> = [
  { key: "externalCode", label: "外部编码", width: 170 },
  { key: "storeName", label: "收货门店", width: 160, required: true },
  { key: "recipientName", label: "收件人", width: 100, required: true },
  { key: "recipientPhone", label: "电话", width: 130, required: true },
  { key: "recipientAddress", label: "地址", width: 220, required: true },
  { key: "skuCode", label: "SKU编码", width: 130, required: true },
  { key: "skuName", label: "SKU名称", width: 160, required: true },
  { key: "skuQuantity", label: "数量", width: 90, required: true, type: "number" },
  { key: "skuSpec", label: "规格型号", width: 130 },
];

export function DataPreviewTable({
  orders,
  onUpdateOrder,
  onDeleteOrder,
  onAddRow,
  errors: externalErrors = [],
  mode = "outbound",
  onValidationChange,
}: DataPreviewTableProps) {
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: string;
  } | null>(null);

  // 用户修改过的字段：记录 (orderId, field) → 标记为 dirty，不再显示对应外部错误
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());

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
    const batchDup = findBatchDuplicates(orders);
    const duplicateKeys: string[] = [];
    const duplicateOrderIds = new Set<string>();
    for (const [key, indices] of batchDup) {
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

    // 3. 合并外部传入的错误（忽略已经被用户修改过的字段）
    const allErrors: ValidationError[] = [...fieldErrors];
    for (const err of externalErrors) {
      const ordersAtRow = orders.filter((o) => (o.sourceRow || 0) === err.row);
      let anyDirty = false;
      for (const o of ordersAtRow) {
        const dirtyKey = `${o.id}|${err.field}`;
        if (dirtyFields.has(dirtyKey)) {
          anyDirty = true;
          break;
        }
      }
      if (anyDirty) continue; // 用户已修改该字段，跳过外部错误

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
  }, [orders, externalErrors, dirtyFields]);

  // 当 orders 数据源变更时（如重新解析），重置 dirtyFields
  const prevOrdersRef = useRef<string>("");
  useEffect(() => {
    const key = orders.map((o) => o.id).join(",");
    if (key !== prevOrdersRef.current) {
      prevOrdersRef.current = key;
      setDirtyFields(new Set());
    }
  }, [orders]);

  useEffect(() => {
    onValidationChange?.({ errors, errorOrderIds: new Set(errorFieldMap.keys()), duplicateCodes });
  }, [errors, errorFieldMap, duplicateCodes, onValidationChange]);

  const isFieldError = (orderId: string, field: string): boolean => {
    const fields = errorFieldMap.get(orderId);
    if (!fields) return false;
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

  // 标记用户修改过的字段（修改后不再显示该字段的外部错误）
  const markDirty = (id: string, field: string) => {
    setDirtyFields((prev) => new Set(prev).add(`${id}|${field}`));
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    id: string,
    field: string,
    currentIndex: number
  ) => {
    const cols = mode === "transfer" ? transferColumns : columns;
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const currentColIndex = cols.findIndex((c) => c.key === field);
      const nextColIndex = e.shiftKey
        ? currentColIndex - 1
        : currentColIndex + 1;

      if (nextColIndex >= 0 && nextColIndex < cols.length) {
        setEditingCell({ id, field: cols[nextColIndex].key });
      } else if (e.key === "Tab" && !e.shiftKey) {
        const nextOrder = orders[currentIndex + 1];
        if (nextOrder) {
          setEditingCell({ id: nextOrder.id, field: cols[0].key });
        }
      } else if (e.shiftKey && currentIndex > 0) {
        const prevOrder = orders[currentIndex - 1];
        setEditingCell({
          id: prevOrder.id,
          field: cols[cols.length - 1].key,
        });
      }
    } else if (e.key === "Escape") {
      handleCellBlur();
    }
  };

  // ============ 扁平表格：每条数据一行 ============
  const activeCols = mode === "transfer" ? transferColumns : columns;
  const totalWidth = 44 + activeCols.reduce((s, c) => s + c.width, 0) + 72;

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

      {/* 表格容器 */}
      <div
        className="border border-[#e5e6eb] rounded-xl overflow-auto"
        style={{ maxHeight: "480px" }}
      >
        <table
          className="w-full text-sm"
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            minWidth: totalWidth,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: 44 }} />
            {activeCols.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
            <col style={{ width: 72 }} />
          </colgroup>

          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-2 py-2.5 text-[11px] font-semibold text-[#4e5969] text-center border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 tracking-wide uppercase">
                #
              </th>
              {activeCols.map((col) => (
                <th
                  key={col.key}
                  className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-2.5 py-2.5 text-[11px] font-semibold text-[#4e5969] text-left border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap tracking-wide uppercase"
                  style={{ width: col.width }}
                >
                  {col.label}
                  {col.required && <span className="text-[#cf1322] ml-0.5">*</span>}
                </th>
              ))}
              <th className="sticky top-0 right-0 z-30 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-2 py-2.5 text-[11px] font-semibold text-[#4e5969] text-center border-b-2 border-b-[#0fc6c2]/40 tracking-wide uppercase shadow-[-2px_0_4px_rgba(0,0,0,0.04)]">
                操作
              </th>
            </tr>
          </thead>

          <tbody>
            {orders.map((order, rowIdx) => {
              const rowHasError = isWholeRowError(order.id);
              const isDup = isDuplicateRow(order.id);
              const rowBg = rowHasError
                ? "bg-[#fff7e8]/40"
                : isDup
                  ? "bg-[#fff1f0]/70"
                  : rowIdx % 2 === 1
                    ? "bg-[#fafbfc]"
                    : "bg-white";

              return (
                <tr
                  key={order.id}
                  className={cn(
                    rowBg,
                    "hover:bg-[#fafbfc]/60 transition-colors",
                    isDup && "ring-1 ring-inset ring-[#ffccc7]"
                  )}
                >
                  {/* # 列 */}
                  <td
                    className={cn(
                      "sticky left-0 z-10 px-2 py-2.5 text-[11px] text-center border-r border-b border-[#f2f3f5] font-mono align-top",
                      rowHasError ? "text-[#cf1322]" : "text-[#86909c]",
                      rowBg
                    )}
                  >
                    {rowIdx + 1}
                    {(rowHasError || isDup) && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#cf1322] ml-1 align-middle" />
                    )}
                  </td>

                  {/* 数据列 */}
                  {activeCols.map((col) => {
                    const isEditing =
                      editingCell?.id === order.id && editingCell?.field === col.key;
                    const value = (order as unknown as Record<string, unknown>)[col.key];
                    const displayValue = value === undefined || value === null ? "" : String(value);
                    const hasFieldError = isFieldError(order.id, col.key);

                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "px-2.5 py-2.5 text-sm border-r border-b border-[#f2f3f5] align-top cursor-pointer",
                          hasFieldError && "bg-[#fff1f0]"
                        )}
                        onClick={() => handleCellClick(order.id, col.key)}
                        title={hasFieldError ? `错误：${[...(errorFieldMap.get(order.id) || [])].join("、")}` : undefined}
                      >
                        {isEditing ? (
                          col.options ? (
                            <select
                              value={displayValue}
                              onChange={(e) => { onUpdateOrder(order.id, col.key, e.target.value); markDirty(order.id, col.key); }}
                              onBlur={handleCellBlur}
                              onKeyDown={(e) => handleKeyDown(e, order.id, col.key, rowIdx)}
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
                              onChange={(e) => { onUpdateOrder(order.id, col.key, e.target.value); markDirty(order.id, col.key); }}
                              onBlur={handleCellBlur}
                              onKeyDown={(e) => handleKeyDown(e, order.id, col.key, rowIdx)}
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
                      </td>
                    );
                  })}

                  {/* 操作列 */}
                  <td
                    className="sticky right-0 z-10 px-2 py-2.5 text-center border-b border-[#f2f3f5] align-top shadow-[-2px_0_4px_rgba(0,0,0,0.04)]"
                    style={{ backgroundColor: rowBg }}
                  >
                    <button
                      onClick={() => onDeleteOrder(order.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#86909c] hover:text-[#cf1322] hover:bg-[#fff1f0] rounded transition-colors whitespace-nowrap"
                      title="删除行"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 错误汇总 */}
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
