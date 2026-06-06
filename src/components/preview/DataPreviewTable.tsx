"use client";

import { useState, useMemo, useEffect } from "react";
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

  // 调拨单模式：把 OrderItem[] 按 (externalCode, storeName) 分组成 3 级结构
  //   transfer (1)  → details (3)  → skus (9)
  const transferGroups = useMemo(() => {
    if (mode !== "transfer") return [];
    // 1) 按 externalCode 分组
    const byCode = new Map<string, OrderItem[]>();
    for (const o of orders) {
      const code = (o.externalCode || "").trim() || "（无调拨单号）";
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code)!.push(o);
    }
    // 2) 每组内按 storeName 分组
    return Array.from(byCode.entries()).map(([externalCode, codeItems]) => {
      const byStore = new Map<string, OrderItem[]>();
      for (const it of codeItems) {
        const storeKey = [
          (it.storeName || "").trim(),
          (it.recipientName || "").trim(),
          (it.recipientPhone || "").trim(),
          (it.recipientAddress || "").trim(),
        ].join("|");
        if (!byStore.has(storeKey)) byStore.set(storeKey, []);
        byStore.get(storeKey)!.push(it);
      }
      const details = Array.from(byStore.values()).map((storeItems) => {
        const first = storeItems[0];
        const totalQty = storeItems.reduce((s, i) => s + (i.skuQuantity || 0), 0);
        return {
          storeName: first.storeName || "",
          recipientName: first.recipientName || "",
          recipientPhone: first.recipientPhone || "",
          recipientAddress: first.recipientAddress || "",
          totalQty,
          skus: storeItems,
        };
      });
      const totalQty = codeItems.reduce((s, i) => s + (i.skuQuantity || 0), 0);
      return { externalCode, totalQty, details };
    });
  }, [orders, mode]);

  // ============ 调拨单模式：Excel rowspan 合并单元格表格 ============
  if (mode === "transfer") {
    const totalDetails = transferGroups.reduce((s, g) => s + g.details.length, 0);

    // 字段归属
    const codeFields = new Set(["externalCode"]);
    const storeFields = new Set([
      "storeName",
      "recipientName",
      "recipientPhone",
      "recipientAddress",
    ]);
    const skuFields = new Set([
      "skuCode",
      "skuName",
      "skuQuantity",
      "skuSpec",
    ]);

    // 调拨单明细的内部类型
    type TDetail = (typeof transferGroups)[number]["details"][number];
    type TGroup = (typeof transferGroups)[number];

    // 行描述符
    type TRow =
      | {
          kind: "sku";
          key: string;
          groupIdx: number;
          detailIdx: number;
          skuIdx: number;
          detailSkuCount: number;
          groupTotalRows: number;
          group: TGroup;
          detail: TDetail;
          sku: OrderItem;
          isFirstRowOfGroup: boolean;
          isFirstRowOfDetail: boolean;
          isFirstRowOfTable: boolean;
        }
      | {
          kind: "empty-store";
          key: string;
          groupIdx: number;
          detailIdx: number;
          detailSkuCount: 1;
          groupTotalRows: number;
          group: TGroup;
          detail: TDetail;
          isFirstRowOfGroup: boolean;
          isFirstRowOfDetail: true;
          isFirstRowOfTable: boolean;
        }
      | {
          kind: "empty-group";
          key: string;
          groupIdx: number;
          groupTotalRows: 1;
          group: TGroup;
          isFirstRowOfGroup: true;
          isFirstRowOfDetail: true;
          isFirstRowOfTable: boolean;
        };

    // 行发射算法
    const flatRows: TRow[] = [];
    let isFirstTableRow = true;
    for (const [gIdx, group] of transferGroups.entries()) {
      const totalSkusInGroup = group.details.reduce(
        (s, d) => s + d.skus.length,
        0
      );

      // 空整组：渲染 1 行占位
      if (totalSkusInGroup === 0) {
        flatRows.push({
          kind: "empty-group",
          key: `eg-${gIdx}`,
          groupIdx: gIdx,
          groupTotalRows: 1,
          group,
          isFirstRowOfGroup: true,
          isFirstRowOfDetail: true,
          isFirstRowOfTable: isFirstTableRow,
        });
        isFirstTableRow = false;
        continue;
      }

      const groupTotalRows = group.details.reduce(
        (s, d) => s + Math.max(d.skus.length, 1),
        0
      );
      let groupFirstRowEmitted = false;

      for (const [dIdx, detail] of group.details.entries()) {
        const detailSkuCount = detail.skus.length;
        const isFirstDetailRowOfGroup = !groupFirstRowEmitted;

        if (detailSkuCount === 0) {
          // 空门店：渲染 1 行占位
          flatRows.push({
            kind: "empty-store",
            key: `es-${gIdx}-${dIdx}`,
            groupIdx: gIdx,
            detailIdx: dIdx,
            detailSkuCount: 1,
            groupTotalRows,
            group,
            detail,
            isFirstRowOfGroup: isFirstDetailRowOfGroup,
            isFirstRowOfDetail: true,
            isFirstRowOfTable: isFirstTableRow,
          });
          isFirstTableRow = false;
          groupFirstRowEmitted = true;
          continue;
        }

        for (const [sIdx, sku] of detail.skus.entries()) {
          flatRows.push({
            kind: "sku",
            key: `sk-${gIdx}-${dIdx}-${sIdx}`,
            groupIdx: gIdx,
            detailIdx: dIdx,
            skuIdx: sIdx,
            detailSkuCount,
            groupTotalRows,
            group,
            detail,
            sku,
            isFirstRowOfGroup: isFirstDetailRowOfGroup,
            isFirstRowOfDetail: sIdx === 0,
            isFirstRowOfTable: isFirstTableRow,
          });
          isFirstTableRow = false;
          groupFirstRowEmitted = true;
        }
      }
    }

    // 单元格 key（用于编辑状态）
    const cellKeyOf = (
      row: TRow,
      field: string
    ): string => {
      if (row.kind === "empty-group")
        return `g-${row.groupIdx}-${field}`;
      if (row.kind === "empty-store")
        return `es-${row.groupIdx}-${row.detailIdx}-${field}`;
      return `s-${row.groupIdx}-${row.detailIdx}-${row.skuIdx}-${field}`;
    };

    // 编辑路由：根据字段归属把更新广播到对应 SKU
    const updateForCell = (row: TRow, field: string, value: string) => {
      if (row.kind === "empty-group") return;
      if (row.kind === "empty-store") {
        // 空门店没有真实 SKU 可更新
        return;
      }
      if (codeFields.has(field)) {
        // 整组广播
        for (const detail of row.group.details) {
          for (const sku of detail.skus) onUpdateOrder(sku.id, field, value);
        }
      } else if (storeFields.has(field)) {
        // 该门店下所有 SKU
        for (const sku of row.detail.skus) onUpdateOrder(sku.id, field, value);
      } else {
        // 单个 SKU
        onUpdateOrder(row.sku.id, field, value);
      }
    };

    // 取值
    const valueForCell = (row: TRow, key: string): string => {
      if (row.kind === "empty-group") return "";
      let v: unknown;
      if (row.kind === "empty-store") {
        if (key === "storeName") v = row.detail.storeName;
        else if (key === "recipientName") v = row.detail.recipientName;
        else if (key === "recipientPhone") v = row.detail.recipientPhone;
        else if (key === "recipientAddress") v = row.detail.recipientAddress;
        else return "";
      } else {
        if (codeFields.has(key) && row.isFirstRowOfGroup) {
          v = row.group.externalCode;
        } else if (storeFields.has(key) && row.isFirstRowOfDetail) {
          if (key === "storeName") v = row.detail.storeName;
          else if (key === "recipientName") v = row.detail.recipientName;
          else if (key === "recipientPhone") v = row.detail.recipientPhone;
          else if (key === "recipientAddress") v = row.detail.recipientAddress;
        } else if (skuFields.has(key)) {
          v = (row.sku as unknown as Record<string, unknown>)[key];
        } else {
          return "";
        }
      }
      return v === undefined || v === null ? "" : String(v);
    };

    // 行级错误聚合
    const rowHasAnyError = (row: TRow): boolean => {
      if (row.kind === "sku") return errorFieldMap.has(row.sku.id);
      const skus =
        row.kind === "empty-group"
          ? row.group.details.flatMap((d) => d.skus)
          : row.detail.skus;
      return skus.some((s) => errorFieldMap.has(s.id));
    };

    // 单元格错误
    const cellHasError = (row: TRow, key: string): boolean => {
      if (row.kind === "empty-group") return false;
      if (row.kind === "empty-store") {
        if (!storeFields.has(key)) return false;
        return row.detail.skus.some(
          (s) => errorFieldMap.get(s.id)?.has(key)
        );
      }
      if (codeFields.has(key)) {
        if (!row.isFirstRowOfGroup) return false;
        return row.group.details
          .flatMap((d) => d.skus)
          .some((s) => errorFieldMap.get(s.id)?.has(key));
      }
      if (storeFields.has(key)) {
        if (!row.isFirstRowOfDetail) return false;
        return row.detail.skus.some(
          (s) => errorFieldMap.get(s.id)?.has(key)
        );
      }
      if (skuFields.has(key)) {
        const set = errorFieldMap.get(row.sku.id);
        return !!set && set.has(key);
      }
      return false;
    };

    // 行底色
    const rowBgClass = (row: TRow): string => {
      if (row.kind === "empty-group") return "bg-[#e8fafa]/60";
      if (row.kind === "empty-store") return "bg-[#f7f8fa]";
      return row.isFirstRowOfDetail ? "bg-[#f7f8fa]" : "bg-white";
    };

    // 行号标签：显示分组序号（flat index）
    const rowLabel = (row: TRow): string => {
      if (row.kind === "empty-group") return `${row.groupIdx + 1}`;
      return `${row.groupIdx + 1}`;
    };

    // 删除整组
    const handleDeleteGroup = (group: TGroup) => {
      for (const detail of group.details) {
        for (const sku of detail.skus) onDeleteOrder(sku.id);
      }
    };

    return (
      <div className="flex flex-col h-full">
        {/* 工具栏 - StatBlock 风格统计 + 操作按钮 */}
        <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_2px_6px_rgba(0,0,0,0.04)] border border-[#e5e6eb] px-5 py-4 mb-3 flex flex-wrap items-center gap-5 lg:gap-7">
          <div className="flex items-center gap-5 lg:gap-7 flex-wrap">
            <StatBlock
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              }
              label="调拨单"
              value={transferGroups.length}
              tone="default"
            />
            <Divider />
            <StatBlock
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              }
              label="调拨明细"
              value={totalDetails}
              tone="default"
            />
            <Divider />
            <StatBlock
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                  <line x1="15" y1="3" x2="15" y2="21" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="3" y1="15" x2="21" y2="15" />
                </svg>
              }
              label="SKU 总数"
              value={orders.length}
              tone="primary"
            />
            {errorFieldMap.size > 0 && (
              <>
                <Divider />
                <StatBlock
                  icon={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  }
                  label="错误行"
                  value={errorFieldMap.size}
                  tone="default"
                />
              </>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {duplicateCodes.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#d97b00] bg-[#fff7e8] border border-[#ffe4ba] rounded-md font-medium">
                <StatusDot status="error" />
                {duplicateCodes.length} 个调拨单内有重复
              </span>
            )}
            <Button size="sm" variant="outline" onClick={onAddRow}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              新增 SKU
            </Button>
          </div>
        </div>

        {/* Excel rowspan 表格 */}
        {flatRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#86909c] bg-[#fafbfc] rounded-xl border border-dashed border-[#e5e6eb]">
            暂无数据，请先上传文件并解析
          </div>
        ) : (
          <div
            className="border border-[#e5e6eb] rounded-xl overflow-auto"
            style={{ maxHeight: "clamp(360px, 65vh, 640px)" }}
          >
            <table
              className="history-table min-w-max w-full text-sm"
              style={{
                borderCollapse: "separate",
                borderSpacing: 0,
                minWidth: 1280,
                tableLayout: "auto",
              }}
            >
              <colgroup>
                <col style={{ width: 48 }} />
                {transferColumns.map((c) => (
                  <col key={c.key} style={{ width: c.width }} />
                ))}
                <col style={{ width: 108 }} />
              </colgroup>

              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-2 py-2.5 text-[11px] font-semibold text-[#4e5969] text-center border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 tracking-wide uppercase">
                    #
                  </th>
                  {transferColumns.map((col) => (
                    <th
                      key={col.key}
                      className="sticky top-0 z-20 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-3 py-2.5 text-[11px] font-semibold text-[#4e5969] border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 whitespace-nowrap text-left tracking-wide uppercase"
                    >
                      {col.label}
                      {col.required && (
                        <span className="text-[#cf1322] ml-0.5">*</span>
                      )}
                    </th>
                  ))}
                  <th className="sticky top-0 right-0 z-30 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-2 py-2.5 text-[11px] font-semibold text-[#4e5969] text-center border-b-2 border-b-[#0fc6c2]/40 tracking-wide uppercase shadow-[-2px_0_4px_rgba(0,0,0,0.04)]">
                    操作
                  </th>
                </tr>
              </thead>

              <tbody>
                {flatRows.map((row) => {
                  const hasErr = rowHasAnyError(row);
                  const groupTopBorder =
                    row.isFirstRowOfGroup && !row.isFirstRowOfTable
                      ? "border-t-2 border-t-[#0fc6c2]/30"
                      : "";

                  return (
                    <tr
                      key={row.key}
                      className={cn(
                        rowBgClass(row),
                        "hover:bg-[#fafbfc]/60",
                        groupTopBorder,
                        hasErr && "ring-1 ring-inset ring-[#ffccc7]/60"
                      )}
                    >
                      {/* # 列 */}
                      {row.isFirstRowOfGroup ? (
                        <td
                          rowSpan={row.groupTotalRows}
                          className={cn(
                            "sticky left-0 z-10 px-2 py-2.5 text-[11px] text-center align-top border-r border-b border-[#f2f3f5] bg-inherit font-mono",
                            "text-[#0fc6c2] font-semibold",
                            hasErr && "text-[#cf1322]"
                          )}
                        >
                          {rowLabel(row)}
                        </td>
                      ) : (
                        <td style={{ display: "none" }} />
                      )}

                      {/* 数据列 — 所有行始终渲染相同数量的 <td> */}
                      {transferColumns.map((col) => {
                        const isCode = codeFields.has(col.key);
                        const isStore = storeFields.has(col.key);
                        const isSku = skuFields.has(col.key);

                        // 判断该单元格是否应该可见
                        let cellVisible: boolean;
                        let rowSpanVal: number | undefined;

                        if (isCode) {
                          cellVisible = row.isFirstRowOfGroup;
                          rowSpanVal = row.groupTotalRows;
                        } else if (isStore) {
                          if (row.kind === "empty-group") {
                            cellVisible = false;
                          } else if (row.kind === "empty-store") {
                            cellVisible = true;
                            rowSpanVal = 1;
                          } else {
                            cellVisible = row.isFirstRowOfDetail;
                            rowSpanVal = row.detailSkuCount;
                          }
                        } else if (isSku) {
                          cellVisible = row.kind === "sku";
                          rowSpanVal = undefined;
                        } else {
                          cellVisible = false;
                        }

                        // 隐藏的单元格仍然渲染 <td> 但 display:none，保证每行 td 数量一致
                        if (!cellVisible) {
                          return <td key={col.key} style={{ display: "none" }} />;
                        }

                        const ck = cellKeyOf(row, col.key);
                        const isEditing =
                          editingCell?.id === ck && editingCell?.field === col.key;
                        const displayValue = valueForCell(row, col.key);
                        const hasFieldError = cellHasError(row, col.key);

                        // 单元格样式
                        const cellClass = cn(
                          "px-2.5 py-2.5 text-sm border-r border-b border-[#f2f3f5] align-top",
                          hasFieldError && "bg-[#fff1f0]",
                          col.key === "externalCode" &&
                            "font-mono font-semibold text-[#1d2129]"
                        );

                        // 渲染编辑输入框
                        const renderInput = () => {
                          if (col.options) {
                            return (
                              <select
                                value={displayValue}
                                onChange={(e) =>
                                  updateForCell(row, col.key, e.target.value)
                                }
                                onBlur={handleCellBlur}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") handleCellBlur();
                                  else if (e.key === "Enter") handleCellBlur();
                                }}
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
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            );
                          }
                          return (
                            <input
                              type={col.type === "number" ? "number" : "text"}
                              value={displayValue}
                              onChange={(e) =>
                                updateForCell(row, col.key, e.target.value)
                              }
                              onBlur={handleCellBlur}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") handleCellBlur();
                                else if (e.key === "Enter") handleCellBlur();
                              }}
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
                          );
                        };

                        return (
                          <td
                            key={col.key}
                            rowSpan={rowSpanVal}
                            className={cellClass}
                            onClick={() => {
                              if (row.kind === "empty-group") return;
                              setEditingCell({ id: ck, field: col.key });
                            }}
                          >
                            {isEditing ? (
                              renderInput()
                            ) : col.key === "externalCode" ? (
                              // 外部编码单元格：运单号 + 摘要徽章（徽章放在第二行，避免单行过宽）
                              <div className="flex flex-col gap-1 min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
                                  <StatusDot status="draft" />
                                  <span
                                    className={cn(
                                      "block truncate flex-1 min-w-0",
                                      hasFieldError && "text-[#cf1322] font-medium",
                                      !displayValue && "text-[#c9cdd4] italic"
                                    )}
                                    title={displayValue}
                                  >
                                    {row.kind === "empty-group" && (isStore || isSku)
                                      ? "—"
                                      : displayValue || "—"}
                                  </span>
                                </div>
                                {row.kind !== "empty-group" &&
                                  (row.group.details.length > 1 ||
                                    (row.group.details[0]?.skus.length ?? 0) > 1) && (
                                    <span
                                      className="inline-flex self-start shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-[#0bada9] bg-white border border-[#0fc6c2]/30 rounded whitespace-nowrap"
                                      title={`包含 ${row.group.details.length} 个门店 / ${row.group.details.reduce(
                                        (s, d) => s + d.skus.length,
                                        0
                                      )} 条 SKU`}
                                    >
                                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                        <line x1="9" y1="3" x2="9" y2="21" />
                                        <line x1="15" y1="3" x2="15" y2="21" />
                                        <line x1="3" y1="9" x2="21" y2="9" />
                                        <line x1="3" y1="15" x2="21" y2="15" />
                                      </svg>
                                      {row.group.details.length} 门店 ·{" "}
                                      {row.group.details.reduce(
                                        (s, d) => s + d.skus.length,
                                        0
                                      )}{" "}
                                      SKU
                                    </span>
                                  )}
                              </div>
                            ) : (
                              <span
                                className={cn(
                                  "block truncate",
                                  hasFieldError &&
                                    "text-[#cf1322] font-medium",
                                  !displayValue && "text-[#c9cdd4] italic"
                                )}
                                title={displayValue}
                              >
                                {row.kind === "empty-group" &&
                                (isStore || isSku)
                                  ? "—"
                                  : displayValue || "—"}
                              </span>
                            )}
                          </td>
                        );
                      })}

                      {/* 操作列 */}
                      {row.isFirstRowOfGroup ? (
                        <td
                          rowSpan={row.groupTotalRows}
                          className="sticky right-0 z-10 px-2 py-2.5 text-center align-top border-b border-[#f2f3f5] bg-inherit shadow-[-2px_0_4px_rgba(0,0,0,0.04)]"
                        >
                          {row.kind === "empty-group" ? (
                            <span className="text-xs text-[#c9cdd4]">—</span>
                          ) : (
                            <button
                              onClick={() => handleDeleteGroup(row.group)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#86909c] hover:text-[#cf1322] hover:bg-[#fff1f0] rounded transition-colors whitespace-nowrap"
                              title="删除整张调拨单"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                              删除
                            </button>
                          )}
                        </td>
                      ) : (
                        <td style={{ display: "none" }} />
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

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

  // ============ 出库单模式：扁平 Excel 风格表格（参照 history 页面表格实现）============
  const totalWidth = 44 + columns.reduce((s, c) => s + c.width, 0) + 72;

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
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
            <col style={{ width: 72 }} />
          </colgroup>

          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-gradient-to-b from-[#f6f8f9] to-[#eef1f4] px-2 py-2.5 text-[11px] font-semibold text-[#4e5969] text-center border-r border-b-2 border-[#e5e6eb] border-b-[#0fc6c2]/40 tracking-wide uppercase">
                #
              </th>
              {columns.map((col) => (
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
                  {/* # 列 - 固定左侧 */}
                  <td
                    className={cn(
                      "sticky left-0 z-10 px-2 py-2.5 text-[11px] text-center border-r border-b border-[#f2f3f5] font-mono align-top",
                      rowHasError
                        ? "text-[#cf1322]"
                        : "text-[#86909c]",
                      rowBg
                    )}
                  >
                    {rowIdx + 1}
                    {(rowHasError || isDup) && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#cf1322] ml-1 align-middle" />
                    )}
                  </td>

                  {/* 数据列 */}
                  {columns.map((col) => {
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
                              onChange={(e) => onUpdateOrder(order.id, col.key, e.target.value)}
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
                              onChange={(e) => onUpdateOrder(order.id, col.key, e.target.value)}
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

                  {/* 操作列 - 固定右侧 */}
                  <td className="sticky right-0 z-10 px-2 py-2.5 text-center border-b border-[#f2f3f5] align-top shadow-[-2px_0_4px_rgba(0,0,0,0.04)]" style={{ backgroundColor: rowBg }}>
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
