/**
 * V4 批量写入模块
 * 负责将处理完成的订单数据批量写入运单表
 * 复用 V2 的 outbound_orders / order_items 表结构
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
 * 使用 UPSERT 策略，基于 external_code + sku_code 去重
 */
export async function writeBatch(
  taskId: string,
  _batchIndex: number,
  rows: Record<string, unknown>[],
  _traceId: string,
): Promise<{ inserted: number; updated: number }> {
  const db = getSql();
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    try {
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

      // 先插入或更新 outbound_orders
      const orderId = uuidv4();
      const existing = await db`
        SELECT id FROM outbound_orders
        WHERE external_code = ${externalCode} AND store_name = ${storeName}
        LIMIT 1
      `;

      let outboundOrderId: string;

      if ((existing as Array<{ id: string }>).length > 0) {
        outboundOrderId = (existing as Array<{ id: string }>)[0].id;
        // 更新
        await db`
          UPDATE outbound_orders
          SET recipient_name = ${recipientName},
              recipient_phone = ${recipientPhone},
              recipient_address = ${recipientAddress},
              remark = ${remark},
              source_file = ${`import_task_${taskId}`},
              source_row = ${sourceRow},
              updated_at = NOW()
          WHERE id = ${outboundOrderId}
        `;
        updated++;
      } else {
        outboundOrderId = orderId;
        await db`
          INSERT INTO outbound_orders (id, external_code, store_name, recipient_name, recipient_phone, recipient_address, remark, source_file, source_row, status, created_at)
          VALUES (${orderId}, ${externalCode}, ${storeName}, ${recipientName}, ${recipientPhone}, ${recipientAddress}, ${remark}, ${`import_task_${taskId}`}, ${sourceRow}, 'imported', NOW())
        `;
        inserted++;
      }

      // 插入 order_items
      await db`
        INSERT INTO order_items (id, outbound_order_id, sku_code, sku_name, sku_quantity, sku_spec, sku_unit, source_row)
        VALUES (${uuidv4()}, ${outboundOrderId}, ${skuCode}, ${skuName}, ${skuQuantity}, ${skuSpec}, ${skuUnit}, ${sourceRow})
        ON CONFLICT DO NOTHING
      `;
    } catch (error) {
      console.error(`[Writer] 写入行失败:`, error);
      throw error;
    }
  }

  return { inserted, updated };
}
