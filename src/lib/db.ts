// 数据库操作层 - 使用 Neon PostgreSQL (Serverless)
// 兼容 Vercel Edge Runtime

import { neon } from "@neondatabase/serverless";
import { OrderItem, ParseRule, ValidationError } from "@/types";

// 获取数据库连接
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(url);
}

// ====== 数据库初始化 ======
export async function initDB() {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      external_code TEXT,
      store_name TEXT,
      recipient_name TEXT,
      recipient_phone TEXT,
      recipient_address TEXT,
      sku_code TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      sku_quantity REAL NOT NULL DEFAULT 0,
      sku_spec TEXT,
      remark TEXT,
      source_file TEXT,
      source_sheet TEXT,
      source_row INTEGER,
      rule_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      errors JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      file_type TEXT,
      global_config JSONB,
      field_mappings JSONB,
      data_region JSONB,
      post_processing JSONB,
      ai_generated INTEGER DEFAULT 0,
      ai_confidence REAL,
      ai_notes TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // 为运单表创建索引
  await sql`
    CREATE INDEX IF NOT EXISTS idx_orders_external_code ON orders(external_code)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_orders_recipient_name ON orders(recipient_name)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)
  `;

  console.log("Database initialized (Neon PostgreSQL)");
}

// ====== 运单相关操作 ======

function mapOrderRow(row: Record<string, unknown>): OrderItem {
  let errors: ValidationError[] | undefined;
  if (row.errors) {
    errors = typeof row.errors === "string"
      ? JSON.parse(row.errors as string)
      : (row.errors as ValidationError[]);
  }
  return {
    id: row.id as string,
    externalCode: (row.external_code as string) || undefined,
    storeName: (row.store_name as string) || undefined,
    recipientName: (row.recipient_name as string) || undefined,
    recipientPhone: (row.recipient_phone as string) || undefined,
    recipientAddress: (row.recipient_address as string) || undefined,
    skuCode: (row.sku_code as string) || "",
    skuName: (row.sku_name as string) || "",
    skuQuantity: Number(row.sku_quantity) || 0,
    skuSpec: (row.sku_spec as string) || undefined,
    remark: (row.remark as string) || undefined,
    sourceFile: (row.source_file as string) || undefined,
    sourceSheet: (row.source_sheet as string) || undefined,
    sourceRow: row.source_row as number | undefined,
    ruleId: (row.rule_id as string) || undefined,
    status: (row.status as OrderItem["status"]) || "draft",
    errors,
    createdAt: row.created_at as string,
    submittedAt: (row.submitted_at as string) || undefined,
  };
}

export async function saveOrders(orders: OrderItem[]): Promise<number> {
  if (orders.length === 0) return 0;
  const sql = getSql();
  const now = new Date().toISOString();

  for (const order of orders) {
    await sql`
      INSERT INTO orders (
        id, external_code, store_name, recipient_name, recipient_phone,
        recipient_address, sku_code, sku_name, sku_quantity, sku_spec,
        remark, source_file, source_sheet, source_row, rule_id,
        status, errors, created_at, submitted_at
      ) VALUES (
        ${order.id},
        ${order.externalCode || null},
        ${order.storeName || null},
        ${order.recipientName || null},
        ${order.recipientPhone || null},
        ${order.recipientAddress || null},
        ${order.skuCode},
        ${order.skuName},
        ${order.skuQuantity},
        ${order.skuSpec || null},
        ${order.remark || null},
        ${order.sourceFile || null},
        ${order.sourceSheet || null},
        ${order.sourceRow || null},
        ${order.ruleId || null},
        ${order.status || 'draft'},
        ${order.errors ? JSON.stringify(order.errors) : null},
        ${order.createdAt || now},
        ${order.submittedAt || null}
      )
      ON CONFLICT (id) DO UPDATE SET
        external_code = EXCLUDED.external_code,
        store_name = EXCLUDED.store_name,
        recipient_name = EXCLUDED.recipient_name,
        recipient_phone = EXCLUDED.recipient_phone,
        recipient_address = EXCLUDED.recipient_address,
        sku_code = EXCLUDED.sku_code,
        sku_name = EXCLUDED.sku_name,
        sku_quantity = EXCLUDED.sku_quantity,
        sku_spec = EXCLUDED.sku_spec,
        remark = EXCLUDED.remark,
        source_file = EXCLUDED.source_file,
        source_sheet = EXCLUDED.source_sheet,
        source_row = EXCLUDED.source_row,
        rule_id = EXCLUDED.rule_id,
        status = EXCLUDED.status,
        errors = EXCLUDED.errors,
        submitted_at = EXCLUDED.submitted_at
    `;
  }

  return orders.length;
}

export async function getOrders(params?: {
  externalCode?: string;
  recipientName?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ orders: OrderItem[]; total: number }> {
  const sql = getSql();
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const whereParts: string[] = [];
  const queryArgs: unknown[] = [];

  if (params?.externalCode) {
    queryArgs.push(`%${params.externalCode}%`);
    whereParts.push(`external_code ILIKE $${queryArgs.length}`);
  }
  if (params?.recipientName) {
    queryArgs.push(`%${params.recipientName}%`);
    whereParts.push(`recipient_name ILIKE $${queryArgs.length}`);
  }
  if (params?.startDate) {
    queryArgs.push(params.startDate);
    whereParts.push(`created_at >= $${queryArgs.length}`);
  }
  if (params?.endDate) {
    queryArgs.push(params.endDate);
    whereParts.push(`created_at <= $${queryArgs.length}`);
  }

  const whereClause = whereParts.length > 0
    ? `WHERE ${whereParts.join(" AND ")}`
    : "";

  // 查询总数
  const countSql = `SELECT COUNT(*) as total FROM orders ${whereClause}`;
  const countResult = await sql(countSql, queryArgs) as Record<string, unknown>[];
  const total = Number(countResult[0].total);

  // 查询分页数据
  const pageArgs = [...queryArgs, pageSize, offset];
  const dataSql = `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT $${queryArgs.length + 1} OFFSET $${queryArgs.length + 2}`;
  const dataResult = await sql(dataSql, pageArgs) as Record<string, unknown>[];

  return {
    orders: dataResult.map(mapOrderRow),
    total,
  };
}

export async function getOrderById(id: string): Promise<OrderItem | null> {
  const sql = getSql();
  const result = await sql`SELECT * FROM orders WHERE id = ${id}`;
  const rows = result as Record<string, unknown>[];
  if (rows.length === 0) return null;
  return mapOrderRow(rows[0]);
}

export async function checkDuplicateExternalCode(
  externalCode: string,
  excludeId?: string
): Promise<boolean> {
  const sql = getSql();
  let result;
  if (excludeId) {
    result = await sql`
      SELECT COUNT(*) as cnt FROM orders
      WHERE external_code = ${externalCode} AND id != ${excludeId}
    `;
  } else {
    result = await sql`
      SELECT COUNT(*) as cnt FROM orders
      WHERE external_code = ${externalCode}
    `;
  }
  const row = (result as Record<string, unknown>[])[0];
  return Number(row.cnt) > 0;
}

export async function deleteOrder(id: string): Promise<boolean> {
  const sql = getSql();
  await sql`DELETE FROM orders WHERE id = ${id}`;
  return true;
}

// ====== 解析规则相关操作 ======

function mapRuleRow(row: Record<string, unknown>): ParseRule {
  const parseJSON = (val: unknown) => {
    if (!val) return undefined;
    return typeof val === "string" ? JSON.parse(val as string) : val;
  };

  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || undefined,
    fileType: (row.file_type as ParseRule["fileType"]) || "excel",
    globalConfig: (parseJSON(row.global_config) as ParseRule["globalConfig"]) || {},
    fieldMappings: (parseJSON(row.field_mappings) as ParseRule["fieldMappings"]) || [],
    dataRegion: (parseJSON(row.data_region) as ParseRule["dataRegion"]) || { skipRows: 0 },
    postProcessing: (parseJSON(row.post_processing) as ParseRule["postProcessing"]),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    createdBy: (row.created_by as string) || undefined,
    aiGenerated: (row.ai_generated as number) === 1,
    aiConfidence: (row.ai_confidence as number) || undefined,
    aiNotes: (row.ai_notes as string) || undefined,
  };
}

export async function saveRule(rule: ParseRule): Promise<ParseRule> {
  const sql = getSql();
  const now = new Date().toISOString();

  await sql`
    INSERT INTO rules (
      id, name, description, file_type,
      global_config, field_mappings, data_region, post_processing,
      ai_generated, ai_confidence, ai_notes, created_by,
      created_at, updated_at
    ) VALUES (
      ${rule.id},
      ${rule.name},
      ${rule.description || null},
      ${rule.fileType},
      ${JSON.stringify(rule.globalConfig)},
      ${JSON.stringify(rule.fieldMappings)},
      ${JSON.stringify(rule.dataRegion)},
      ${rule.postProcessing ? JSON.stringify(rule.postProcessing) : null},
      ${rule.aiGenerated ? 1 : 0},
      ${rule.aiConfidence || null},
      ${rule.aiNotes || null},
      ${rule.createdBy || null},
      ${rule.createdAt || now},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      file_type = EXCLUDED.file_type,
      global_config = EXCLUDED.global_config,
      field_mappings = EXCLUDED.field_mappings,
      data_region = EXCLUDED.data_region,
      post_processing = EXCLUDED.post_processing,
      ai_generated = EXCLUDED.ai_generated,
      ai_confidence = EXCLUDED.ai_confidence,
      ai_notes = EXCLUDED.ai_notes,
      created_by = EXCLUDED.created_by,
      updated_at = ${now}
  `;

  return rule;
}

export async function getRules(): Promise<ParseRule[]> {
  const sql = getSql();
  const result = await sql`SELECT * FROM rules ORDER BY updated_at DESC`;
  return (result as Record<string, unknown>[]).map(mapRuleRow);
}

export async function getRuleById(id: string): Promise<ParseRule | null> {
  const sql = getSql();
  const result = await sql`SELECT * FROM rules WHERE id = ${id}`;
  const rows = result as Record<string, unknown>[];
  if (rows.length === 0) return null;
  return mapRuleRow(rows[0]);
}

export async function deleteRule(id: string): Promise<boolean> {
  const sql = getSql();
  await sql`DELETE FROM rules WHERE id = ${id}`;
  return true;
}
