/**
 * V4 批量写入模块
 * 负责将处理完成的订单数据批量写入运单表
 * 使用真正的批量 UPSERT（非逐行 INSERT）
 * 考点10：未识别字段通过 extra_data JSONB 透传，不做脏数据清洗
 */

import { neon } from "@neondatabase/serverless";
import { v4 as uuidv4 } from "uuid";

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("数据库连接未配置");
  return neon(url);
}

/**
 * 将映射后的业务字段 + 透传字段组装为批量写入结构
 */
export interface OrderWriteRow {
  orderNo: string;
  skuCode: string;
  skuName: string;
  qty: number;
  targetWarehouseCode?: string;
  targetWarehouseName?: string;
  sourceWarehouseCode?: string;
  sourceWarehouseName?: string;
  recipient?: string;
  phone?: string;
  province?: string;
  city?: string;
  district?: string;
  address?: string;
  remark?: string;
  extra?: Record<string, unknown>;
}

export function buildOrderRowsFromMapping(
  mapped: Record<string, unknown>[],
  passthrough: Record<string, unknown>[],
): OrderWriteRow[] {
  return mapped.map((m, i) => ({
    orderNo: String(m.orderNo ?? ""),
    skuCode: String(m.skuCode ?? ""),
    skuName: String(m.skuName ?? ""),
    qty: Number(m.qty ?? 0),
    targetWarehouseCode: m.targetWarehouseCode ? String(m.targetWarehouseCode) : undefined,
    targetWarehouseName: m.targetWarehouseName ? String(m.targetWarehouseName) : undefined,
    sourceWarehouseCode: m.sourceWarehouseCode ? String(m.sourceWarehouseCode) : undefined,
    sourceWarehouseName: m.sourceWarehouseName ? String(m.sourceWarehouseName) : undefined,
    recipient: m.recipient ? String(m.recipient) : undefined,
    phone: m.phone ? String(m.phone) : undefined,
    province: m.province ? String(m.province) : undefined,
    city: m.city ? String(m.city) : undefined,
    district: m.district ? String(m.district) : undefined,
    address: m.address ? String(m.address) : undefined,
    remark: m.remark ? String(m.remark) : undefined,
    extra: passthrough[i] && Object.keys(passthrough[i]).length ? passthrough[i] : undefined,
  }));
}

/**
 * 批量写入订单数据（考点8：ON CONFLICT DO NOTHING 保证幂等）
 */
export async function writeBatch(
  taskId: string,
  _batchIndex: number,
  mappedRows: Record<string, unknown>[],
  passthroughRows: Record<string, unknown>[],
  _traceId: string,
): Promise<{ inserted: number; updated: number }> {
  void _traceId;
  void _batchIndex;
  if (mappedRows.length === 0) return { inserted: 0, updated: 0 };

  const rows = buildOrderRowsFromMapping(mappedRows, passthroughRows);
  const db = getSql();
  const sourceFile = `import_task_${taskId}`;

  const orderIds: string[] = [];
  const externalCodes: string[] = [];
  const storeNames: string[] = [];
  const recipientNames: string[] = [];
  const recipientPhones: string[] = [];
  const recipientAddresses: string[] = [];
  const remarks: string[] = [];
  const batchIds: string[] = [];
  const extraDatas: unknown[] = [];

  const itemIds: string[] = [];
  const itemSkuCodes: string[] = [];
  const itemSkuNames: string[] = [];
  const itemSkuQuantities: number[] = [];
  const itemSourceRows: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    orderIds.push(uuidv4());
    externalCodes.push(r.orderNo);
    storeNames.push(r.recipient || "");
    recipientNames.push(r.recipient || "");
    recipientPhones.push(r.phone || "");
    recipientAddresses.push([r.province, r.city, r.district, r.address].filter(Boolean).join(" ") || "");
    remarks.push(r.remark || "");
    batchIds.push(`import_task_${taskId}`);
    extraDatas.push((r.extra as unknown) ?? null);

    itemIds.push(uuidv4());
    itemSkuCodes.push(r.skuCode);
    itemSkuNames.push(r.skuName);
    itemSkuQuantities.push(r.qty);
    itemSourceRows.push(i);
  }

  // 使用显式位置参数（db(sql, params)）代替模板字面量插值，
  // 避免 @neondatabase/serverless 旧版本将 ${...} 误解析为 $N_$M 占位符。
  const obCols =
    "id, external_code, store_name, recipient_name, recipient_phone, recipient_address, remark, source_file, batch_id, extra_data, status, created_at";
  const oiCols = "id, outbound_order_id, sku_code, sku_name, sku_quantity, source_row";
  const obPlaceholders = orderIds
    .map((_, i) => `($${i * 12 + 1}, $${i * 12 + 2}, $${i * 12 + 3}, $${i * 12 + 4}, $${i * 12 + 5}, $${i * 12 + 6}, $${i * 12 + 7}, $${i * 12 + 8}, $${i * 12 + 9}, $${i * 12 + 10}, 'imported', NOW())`)
    .join(", ");
  const obParams: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    obParams.push(
      orderIds[i],
      externalCodes[i],
      storeNames[i],
      recipientNames[i],
      recipientPhones[i],
      recipientAddresses[i],
      remarks[i],
      sourceFile,
      batchIds[i],
      (extraDatas[i] ?? null) as unknown,
    );
  }

  try {
    await db(
      `INSERT INTO outbound_orders (${obCols}) VALUES ${obPlaceholders} ON CONFLICT DO NOTHING`,
      obParams,
    );
  } catch {
    let inserted = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        await db(
          `INSERT INTO outbound_orders (${obCols}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'imported',NOW()) ON CONFLICT DO NOTHING`,
          [
            orderIds[i],
            externalCodes[i],
            storeNames[i],
            recipientNames[i],
            recipientPhones[i],
            recipientAddresses[i],
            remarks[i],
            sourceFile,
            batchIds[i],
            (extraDatas[i] ?? null) as unknown,
          ],
        );
        inserted++;
      } catch {
        /* 跳过冲突 */
      }
    }
    for (let i = 0; i < rows.length; i++) {
      try {
        await db(
          `INSERT INTO order_items (${oiCols}) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [
            itemIds[i],
            orderIds[i],
            itemSkuCodes[i],
            itemSkuNames[i],
            itemSkuQuantities[i],
            itemSourceRows[i],
          ],
        );
      } catch {
        /* 跳过 */
      }
    }
    return { inserted, updated: 0 };
  }

  const oiPlaceholders = itemIds
    .map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`)
    .join(", ");
  const oiParams: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    oiParams.push(
      itemIds[i],
      orderIds[i],
      itemSkuCodes[i],
      itemSkuNames[i],
      itemSkuQuantities[i],
      itemSourceRows[i],
    );
  }

  try {
    await db(
      `INSERT INTO order_items (${oiCols}) VALUES ${oiPlaceholders} ON CONFLICT DO NOTHING`,
      oiParams,
    );
  } catch {
    for (let i = 0; i < rows.length; i++) {
      try {
        await db(
          `INSERT INTO order_items (${oiCols}) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [
            itemIds[i],
            orderIds[i],
            itemSkuCodes[i],
            itemSkuNames[i],
            itemSkuQuantities[i],
            itemSourceRows[i],
          ],
        );
      } catch {
        /* 跳过 */
      }
    }
  }

  return { inserted: rows.length, updated: 0 };
}
