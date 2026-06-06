// 数据库操作层 - 使用 Neon PostgreSQL (Serverless)
// 兼容 Vercel Edge Runtime
// 无 DATABASE_URL 时回退到本地 JSON 文件存储
// 父子表设计：
//   - outbound_orders: 父单（按 externalCode 聚合，保存收货门店、收件人、地址等共享字段）
//   - order_items: 子表（每条 SKU 一行，FK → outbound_orders.id）

import { neon } from "@neondatabase/serverless";
import { OrderItem, OutboundOrder, ParseRule, ValidationError } from "@/types";
import { promises as fs } from "fs";
import * as path from "path";

// 数据文件路径（无数据库时的回退方案）
const DATA_DIR = path.join(process.cwd(), ".data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

// 本地文件存储接口
interface LocalStore {
  rules: Record<string, ParseRule>;
  // 用 OutboundOrder 序列化保存
  orders: Record<string, OutboundOrder>;
}

// 读取本地存储
async function readLocalStore(): Promise<LocalStore> {
  try {
    const raw = await fs.readFile(ORDERS_FILE, "utf-8");
    return JSON.parse(raw) as LocalStore;
  } catch {
    return { rules: {}, orders: {} };
  }
}

// 写入本地存储
async function writeLocalStore(store: LocalStore): Promise<void> {
  // Vercel 等 Serverless 平台文件系统只读，禁止写本地文件
  if (process.env.VERCEL === "1") {
    throw new Error(
      "Vercel 部署必须配置 DATABASE_URL 环境变量（推荐 Neon PostgreSQL），当前未配置数据库连接"
    );
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ORDERS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// 是否有数据库连接
function hasDatabase(): boolean {
  return !!(process.env.DATABASE_URL || FALLBACK_DATABASE_URL);
}

// 获取数据库连接
function getSql() {
  const url = process.env.DATABASE_URL || FALLBACK_DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(url);
}

// 兜底配置：未设置环境变量时使用（仅供个人项目/本地开发用，勿用于公开仓库）
const FALLBACK_DATABASE_URL =
  "postgresql://neondb_owner:npg_mVh6iMlYUyc4@ep-ancient-mode-apjafd5f-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";

// ====== 按 externalCode 把 OrderItem[] 聚合成 OutboundOrder[] ======
function groupItemsIntoOutboundOrders(items: OrderItem[]): OutboundOrder[] {
  const groups = new Map<string, OutboundOrder>();

  for (const item of items) {
    // 用 externalCode 作为聚合 key；缺失时退化为 "__no_code__" 单独一组
    const key = item.externalCode || "__no_code__";
    if (!groups.has(key)) {
      groups.set(key, {
        id: `out_${key}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        externalCode: item.externalCode,
        storeName: item.storeName,
        recipientName: item.recipientName,
        recipientPhone: item.recipientPhone,
        recipientAddress: item.recipientAddress,
        remark: item.remark,
        sourceFile: item.sourceFile,
        sourceSheet: item.sourceSheet,
        sourceRow: item.sourceRow,
        ruleId: item.ruleId,
        status: item.status || "draft",
        items: [],
        createdAt: item.createdAt,
        submittedAt: item.submittedAt,
      });
    }
    const group = groups.get(key)!;
    group.items.push({ ...item, outboundOrderId: group.id });
  }

  return Array.from(groups.values());
}

// ====== 数据库初始化 ======
export async function initDB() {
  if (!hasDatabase()) {
    console.log("No DATABASE_URL, using local file storage");
    return;
  }
  const sql = getSql();

  // 父表：出库单
  await sql`
    CREATE TABLE IF NOT EXISTS outbound_orders (
      id TEXT PRIMARY KEY,
      external_code TEXT,
      store_name TEXT,
      recipient_name TEXT,
      recipient_phone TEXT,
      recipient_address TEXT,
      remark TEXT,
      source_file TEXT,
      source_sheet TEXT,
      source_row INTEGER,
      rule_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ
    )
  `;

  // 子表：SKU 行
  await sql`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      outbound_order_id TEXT NOT NULL REFERENCES outbound_orders(id) ON DELETE CASCADE,
      sku_code TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      sku_quantity REAL NOT NULL DEFAULT 0,
      sku_spec TEXT,
      source_row INTEGER,
      errors JSONB
    )
  `;

  // 父表索引
  await sql`CREATE INDEX IF NOT EXISTS idx_outbound_external_code ON outbound_orders(external_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_outbound_recipient_name ON outbound_orders(recipient_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_outbound_created_at ON outbound_orders(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_orders(status)`;
  // 子表索引
  await sql`CREATE INDEX IF NOT EXISTS idx_items_outbound_id ON order_items(outbound_order_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_items_sku_code ON order_items(sku_code)`;

  // 规则表（保持不变）
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

  console.log("Database initialized (Neon PostgreSQL, parent-child schema)")
}

// ====== 出库单相关操作 ======

function mapOutboundRow(row: Record<string, unknown>, items: OrderItem[]): OutboundOrder {
  return {
    id: row.id as string,
    externalCode: (row.external_code as string) || undefined,
    storeName: (row.store_name as string) || undefined,
    recipientName: (row.recipient_name as string) || undefined,
    recipientPhone: (row.recipient_phone as string) || undefined,
    recipientAddress: (row.recipient_address as string) || undefined,
    remark: (row.remark as string) || undefined,
    sourceFile: (row.source_file as string) || undefined,
    sourceSheet: (row.source_sheet as string) || undefined,
    sourceRow: row.source_row as number | undefined,
    ruleId: (row.rule_id as string) || undefined,
    status: (row.status as OutboundOrder["status"]) || "draft",
    items,
    createdAt: row.created_at as string,
    submittedAt: (row.submitted_at as string) || undefined,
  };
}

function mapItemRow(row: Record<string, unknown>, parent: Partial<OutboundOrder>): OrderItem {
  let errors: ValidationError[] | undefined;
  if (row.errors) {
    errors = typeof row.errors === "string"
      ? JSON.parse(row.errors as string)
      : (row.errors as ValidationError[]);
  }
  return {
    id: row.id as string,
    outboundOrderId: row.outbound_order_id as string,
    externalCode: parent.externalCode,
    storeName: parent.storeName,
    recipientName: parent.recipientName,
    recipientPhone: parent.recipientPhone,
    recipientAddress: parent.recipientAddress,
    remark: parent.remark,
    sourceFile: parent.sourceFile,
    sourceSheet: parent.sourceSheet,
    ruleId: parent.ruleId,
    status: parent.status || "draft",
    skuCode: (row.sku_code as string) || "",
    skuName: (row.sku_name as string) || "",
    skuQuantity: Number(row.sku_quantity) || 0,
    skuSpec: (row.sku_spec as string) || undefined,
    sourceRow: row.source_row as number | undefined,
    errors,
    createdAt: parent.createdAt || "",
    submittedAt: parent.submittedAt,
  };
}

/**
 * 保存订单：接受 OrderItem[]，按 externalCode 聚合后插入父表 + 子表
 * 已存在同 externalCode 的父单 → 覆盖（去重）
 */
export async function saveOrders(items: OrderItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const outbounds = groupItemsIntoOutboundOrders(items);

  if (!hasDatabase()) {
    // 本地存储：直接保存聚合后的 OutboundOrder
    const store = await readLocalStore();
    for (const ob of outbounds) {
      store.orders[ob.id] = ob;
    }
    await writeLocalStore(store);
    return outbounds.length;
  }

  const sql = getSql();
  const now = new Date().toISOString();
  let savedCount = 0;

  for (const ob of outbounds) {
    // 1. UPSERT 父单（按 external_code 唯一匹配）
    const parentId = await sql`
      INSERT INTO outbound_orders (
        id, external_code, store_name, recipient_name, recipient_phone,
        recipient_address, remark, source_file, source_sheet, source_row,
        rule_id, status, created_at, submitted_at
      ) VALUES (
        ${ob.id},
        ${ob.externalCode || null},
        ${ob.storeName || null},
        ${ob.recipientName || null},
        ${ob.recipientPhone || null},
        ${ob.recipientAddress || null},
        ${ob.remark || null},
        ${ob.sourceFile || null},
        ${ob.sourceSheet || null},
        ${ob.sourceRow || null},
        ${ob.ruleId || null},
        ${ob.status || "draft"},
        ${ob.createdAt || now},
        ${ob.submittedAt || null}
      )
      ON CONFLICT (id) DO UPDATE SET
        external_code = EXCLUDED.external_code,
        store_name = EXCLUDED.store_name,
        recipient_name = EXCLUDED.recipient_name,
        recipient_phone = EXCLUDED.recipient_phone,
        recipient_address = EXCLUDED.recipient_address,
        remark = EXCLUDED.remark,
        source_file = EXCLUDED.source_file,
        source_sheet = EXCLUDED.source_sheet,
        source_row = EXCLUDED.source_row,
        rule_id = EXCLUDED.rule_id,
        status = EXCLUDED.status,
        submitted_at = EXCLUDED.submitted_at
      RETURNING id
    `;
    const finalParentId = (parentId as Record<string, unknown>[])[0]?.id as string || ob.id;

    // 2. 清理该父单下旧 SKU 行（覆盖语义：旧数据被替换）
    await sql`DELETE FROM order_items WHERE outbound_order_id = ${finalParentId}`;

    // 3. 批量插入新 SKU 行
    for (const item of ob.items) {
      await sql`
        INSERT INTO order_items (
          id, outbound_order_id, sku_code, sku_name, sku_quantity, sku_spec, source_row, errors
        ) VALUES (
          ${item.id},
          ${finalParentId},
          ${item.skuCode},
          ${item.skuName},
          ${item.skuQuantity},
          ${item.skuSpec || null},
          ${item.sourceRow || null},
          ${item.errors ? JSON.stringify(item.errors) : null}
        )
      `;
    }
    savedCount++;
  }

  return savedCount;
}

/**
 * 列出出库单（带子项）
 */
export async function getOrders(params?: {
  externalCode?: string;
  recipientName?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ orders: OutboundOrder[]; total: number }> {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const offset = (page - 1) * pageSize;

  if (!hasDatabase()) {
    const store = await readLocalStore();
    let all = Object.values(store.orders);
    if (params?.externalCode) {
      all = all.filter((o) => (o.externalCode || "").includes(params.externalCode!));
    }
    if (params?.recipientName) {
      all = all.filter((o) => (o.recipientName || "").includes(params.recipientName!));
    }
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { orders: all.slice(offset, offset + pageSize), total: all.length };
  }

  const sql = getSql();

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

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  // 查询总数
  const countSql = `SELECT COUNT(*) as total FROM outbound_orders ${whereClause}`;
  const countResult = await sql(countSql, queryArgs) as Record<string, unknown>[];
  const total = Number(countResult[0].total);

  // 查询分页数据
  const pageArgs = [...queryArgs, pageSize, offset];
  const dataSql = `SELECT * FROM outbound_orders ${whereClause} ORDER BY created_at DESC LIMIT $${queryArgs.length + 1} OFFSET $${queryArgs.length + 2}`;
  const dataResult = await sql(dataSql, pageArgs) as Record<string, unknown>[];

  // 批量加载所有相关子项（一次查询）
  const parentIds = dataResult.map((r) => r.id as string);
  let items: OrderItem[] = [];
  if (parentIds.length > 0) {
    const itemsResult = await sql`
      SELECT * FROM order_items WHERE outbound_order_id = ANY(${parentIds})
    ` as Record<string, unknown>[];
    const parentMap = new Map<string, Record<string, unknown>>();
    for (const r of dataResult) parentMap.set(r.id as string, r);
    items = itemsResult.map((ir) => {
      const parent = parentMap.get(ir.outbound_order_id as string);
      return mapItemRow(ir, parent ? mapOutboundRow(parent, []) : {});
    });
  }

  // 按父单 ID 分组子项
  const itemsByParent = new Map<string, OrderItem[]>();
  for (const it of items) {
    const pid = it.outboundOrderId!;
    if (!itemsByParent.has(pid)) itemsByParent.set(pid, []);
    itemsByParent.get(pid)!.push(it);
  }

  return {
    orders: dataResult.map((r) => mapOutboundRow(r, itemsByParent.get(r.id as string) || [])),
    total,
  };
}

/**
 * 获取单个出库单（带子项）
 */
export async function getOrderById(id: string): Promise<OutboundOrder | null> {
  if (!hasDatabase()) {
    const store = await readLocalStore();
    return store.orders[id] || null;
  }
  const sql = getSql();
  const result = await sql`SELECT * FROM outbound_orders WHERE id = ${id}`;
  const rows = result as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const parent = mapOutboundRow(rows[0], []);
  const itemsResult = await sql`SELECT * FROM order_items WHERE outbound_order_id = ${id}` as Record<string, unknown>[];
  parent.items = itemsResult.map((ir) => mapItemRow(ir, parent));
  return parent;
}

/**
 * 重复外部编码检查（仅返回 boolean）
 */
export async function checkDuplicateExternalCode(
  externalCode: string,
  excludeId?: string
): Promise<boolean> {
  if (!hasDatabase()) {
    const store = await readLocalStore();
    return Object.values(store.orders).some(
      (o) => o.externalCode === externalCode && o.id !== excludeId
    );
  }
  const sql = getSql();
  let result;
  if (excludeId) {
    result = await sql`
      SELECT COUNT(*) as cnt FROM outbound_orders
      WHERE external_code = ${externalCode} AND id != ${excludeId}
    `;
  } else {
    result = await sql`
      SELECT COUNT(*) as cnt FROM outbound_orders
      WHERE external_code = ${externalCode}
    `;
  }
  const row = (result as Record<string, unknown>[])[0];
  return Number(row.cnt) > 0;
}

/**
 * 查询已存在的外部编码完整信息（id + createdAt）
 * 返回 Map<externalCode, {id, createdAt}>
 */
export async function findExternalCodesInDb(
  codes: string[]
): Promise<Map<string, { id: string; createdAt: string }>> {
  const result = new Map<string, { id: string; createdAt: string }>();
  if (codes.length === 0) return result;
  const unique = Array.from(new Set(codes.map((c) => (c || "").trim()).filter(Boolean)));

  if (!hasDatabase()) {
    const store = await readLocalStore();
    for (const code of unique) {
      const ob = Object.values(store.orders).find((o) => o.externalCode === code);
      if (ob) {
        result.set(code, { id: ob.id, createdAt: ob.createdAt });
      }
    }
    return result;
  }

  const sql = getSql();
  // 一次查询所有候选 code
  const rows = await sql`
    SELECT id, external_code, created_at FROM outbound_orders
    WHERE external_code = ANY(${unique})
  ` as Record<string, unknown>[];

  for (const row of rows) {
    const code = (row.external_code as string) || "";
    if (code) {
      result.set(code, {
        id: row.id as string,
        createdAt: row.created_at as string,
      });
    }
  }
  return result;
}

/**
 * 删除出库单（CASCADE 自动删除子项）
 */
export async function deleteOrder(id: string): Promise<boolean> {
  if (!hasDatabase()) {
    const store = await readLocalStore();
    if (store.orders[id]) {
      delete store.orders[id];
      await writeLocalStore(store);
      return true;
    }
    return false;
  }
  const sql = getSql();
  await sql`DELETE FROM outbound_orders WHERE id = ${id}`;
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
  if (hasDatabase()) {
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

  // 本地文件存储回退
  const store = await readLocalStore();
  const now = new Date().toISOString();
  store.rules[rule.id] = {
    ...rule,
    updatedAt: now,
    createdAt: rule.createdAt || now,
  };
  await writeLocalStore(store);
  return store.rules[rule.id];
}

export async function getRules(): Promise<ParseRule[]> {
  if (hasDatabase()) {
    const sql = getSql();
    const result = await sql`SELECT * FROM rules ORDER BY updated_at DESC`;
    return (result as Record<string, unknown>[]).map(mapRuleRow);
  }

  const store = await readLocalStore();
  return Object.values(store.rules).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getRuleById(id: string): Promise<ParseRule | null> {
  if (hasDatabase()) {
    const sql = getSql();
    const result = await sql`SELECT * FROM rules WHERE id = ${id}`;
    const rows = result as Record<string, unknown>[];
    if (rows.length === 0) return null;
    return mapRuleRow(rows[0]);
  }

  const store = await readLocalStore();
  return store.rules[id] || null;
}

export async function deleteRule(id: string): Promise<boolean> {
  if (hasDatabase()) {
    const sql = getSql();
    await sql`DELETE FROM rules WHERE id = ${id}`;
    return true;
  }

  const store = await readLocalStore();
  if (store.rules[id]) {
    delete store.rules[id];
    await writeLocalStore(store);
    return true;
  }
  return false;
}
