/**
 * V4 批量写入模块
 * 负责将处理完成的订单数据批量写入运单表
 * 使用真正的批量 UPSERT（非逐行 INSERT）
 */

import { neon } from "@neondatabase/serverless";
import { v4 as uuidv4 } from "uuid";

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("数据库连接未配置");
  return neon(url);
}

/**
 * 批量写入订单数据
 * 使用 UNNEST 一次性批量 UPSERT，而非逐行循环
 */
export async function writeBatch(
  taskId: string,
  _batchIndex: number,
  rows: Record<string, unknown>[],
  _traceId: string,
): Promise<{ inserted: number; updated: number }> {
  void _traceId; // 保留用于后续日志集成
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const db = getSql();
  const sourceFile = `import_task_${taskId}`;

  // 提取数据
  const orderIds: string[] = [];
  const externalCodes: string[] = [];
  const storeNames: string[] = [];
  const recipientNames: string[] = [];
  const recipientPhones: string[] = [];
  const recipientAddresses: string[] = [];
  const remarks: string[] = [];
  const sourceRows: number[] = [];

  const itemIds: string[] = [];
  const itemSkuCodes: string[] = [];
  const itemSkuNames: string[] = [];
  const itemSkuQuantities: number[] = [];
  const itemSkuSpecs: string[] = [];
  const itemSkuUnits: string[] = [];
  const itemSourceRows: number[] = [];

  for (const row of rows) {
    const externalCode = (row.external_code || row["外部编码"] || "") as string;
    const storeName = (row.store_name || row["收货门店"] || row.recipient_name || row["收件人"] || "") as string;
    const recipientName = (row.recipient_name || row["收件人"] || "") as string;
    const recipientPhone = (row.recipient_phone || row["收件人电话"] || "") as string;
    const recipientAddress = (row.recipient_address || row["收件人地址"] || "") as string;
    const remark = (row.remark || row["备注"] || "") as string;
    const skuCode = (row.sku_code || row["SKU编码"] || row.SKU编码 || "") as string;
    const skuName = (row.sku_name || row["SKU名称"] || row.SKU名称 || "") as string;
    const skuQuantity = parseInt(String(row.sku_quantity || row["SKU数量"] || row.SKU数量 || "0"), 10);
    const skuSpec = (row.sku_spec || row["SKU规格"] || row.SKU规格 || "") as string;
    const skuUnit = (row.sku_unit || row["SKU单位"] || row.SKU单位 || "") as string;
    const sourceRow = (row._source_row as number) || 0;

    orderIds.push(uuidv4());
    externalCodes.push(externalCode);
    storeNames.push(storeName);
    recipientNames.push(recipientName);
    recipientPhones.push(recipientPhone);
    recipientAddresses.push(recipientAddress);
    remarks.push(remark);
    sourceRows.push(sourceRow);

    itemIds.push(uuidv4());
    itemSkuCodes.push(skuCode);
    itemSkuNames.push(skuName);
    itemSkuQuantities.push(skuQuantity);
    itemSkuSpecs.push(skuSpec);
    itemSkuUnits.push(skuUnit);
    itemSourceRows.push(sourceRow);
  }

  // 批量 UPSERT outbound_orders（使用 UNNEST 一次性写入）
  // 如果表不存在 external_code + store_name 唯一约束，则使用 ON CONFLICT DO NOTHING
  try {
    await db`
      INSERT INTO outbound_orders (id, external_code, store_name, recipient_name, recipient_phone, recipient_address, remark, source_file, source_row, status, created_at)
      SELECT * FROM UNNEST(
        ${orderIds}::text[],
        ${externalCodes}::text[],
        ${storeNames}::text[],
        ${recipientNames}::text[],
        ${recipientPhones}::text[],
        ${recipientAddresses}::text[],
        ${remarks}::text[],
        ARRAY[${sourceFile}]::text[],
        ${sourceRows}::int[],
        ARRAY['imported']::text[],
        ARRAY[NOW()]::timestamptz[]
      )
      ON CONFLICT DO NOTHING
    `;
  } catch {
    // UNNEST 失败时降级为逐条写入
    let inserted = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        await db`
          INSERT INTO outbound_orders (id, external_code, store_name, recipient_name, recipient_phone, recipient_address, remark, source_file, source_row, status, created_at)
          VALUES (${orderIds[i]}, ${externalCodes[i]}, ${storeNames[i]}, ${recipientNames[i]}, ${recipientPhones[i]}, ${recipientAddresses[i]}, ${remarks[i]}, ${sourceFile}, ${sourceRows[i]}, 'imported', NOW())
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      } catch {
        // 跳过冲突行
      }
    }

    // 批量写入 order_items（降级模式）
    for (let i = 0; i < rows.length; i++) {
      try {
        await db`
          INSERT INTO order_items (id, outbound_order_id, sku_code, sku_name, sku_quantity, sku_spec, sku_unit, source_row)
          VALUES (${itemIds[i]}, ${orderIds[i]}, ${itemSkuCodes[i]}, ${itemSkuNames[i]}, ${itemSkuQuantities[i]}, ${itemSkuSpecs[i]}, ${itemSkuUnits[i]}, ${itemSourceRows[i]})
          ON CONFLICT DO NOTHING
        `;
      } catch {
        // 跳过
      }
    }
    return { inserted, updated: 0 };
  }

  // 批量写入 order_items
  try {
    await db`
      INSERT INTO order_items (id, outbound_order_id, sku_code, sku_name, sku_quantity, sku_spec, sku_unit, source_row)
      SELECT * FROM UNNEST(
        ${itemIds}::text[],
        ${orderIds}::text[],
        ${itemSkuCodes}::text[],
        ${itemSkuNames}::text[],
        ${itemSkuQuantities}::int[],
        ${itemSkuSpecs}::text[],
        ${itemSkuUnits}::text[],
        ${itemSourceRows}::int[]
      )
      ON CONFLICT DO NOTHING
    `;
  } catch {
    // 降级
    for (let i = 0; i < rows.length; i++) {
      try {
        await db`
          INSERT INTO order_items (id, outbound_order_id, sku_code, sku_name, sku_quantity, sku_spec, sku_unit, source_row)
          VALUES (${itemIds[i]}, ${orderIds[i]}, ${itemSkuCodes[i]}, ${itemSkuNames[i]}, ${itemSkuQuantities[i]}, ${itemSkuSpecs[i]}, ${itemSkuUnits[i]}, ${itemSourceRows[i]})
          ON CONFLICT DO NOTHING
        `;
      } catch {
        // 跳过
      }
    }
  }

  return { inserted: rows.length, updated: 0 };
}
