// 数据库操作层 - 使用 Neon PostgreSQL (Serverless)
// 兼容 Vercel Edge Runtime
// 无 DATABASE_URL 时回退到本地 JSON 文件存储
// 三层结构（调拨单模式）：
//   - transfer_orders: 调拨单头（按 externalCode 聚合，1 调拨单 = 1 行）
//   - outbound_orders: 调拨明细（按 externalCode+storeName 聚合，FK → transfer_orders.id）
//   - order_items: SKU 明细（每条 SKU 一行，FK → outbound_orders.id）
// 出库单模式（兼容）：
//   - outbound_orders: 父单（按 externalCode 聚合，1 出库单 = 1 行）
//   - order_items: 子表（每条 SKU 一行，FK → outbound_orders.id）

import { neon } from "@neondatabase/serverless";
import { OrderItem, OutboundOrder, ParseRule, ValidationError, TransferOrder } from "@/types";
import { promises as fs } from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

// 数据文件路径（无数据库时的回退方案）
const DATA_DIR = path.join(process.cwd(), ".data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

// 本地文件存储接口
interface LocalStore {
  rules: Record<string, ParseRule>;
  // 出库单（outbound 模式 + transfer 模式的明细）
  orders: Record<string, OutboundOrder>;
  // 调拨单（transfer 模式顶层）
  transfers: Record<string, TransferOrder>;
}

// 读取本地存储
async function readLocalStore(): Promise<LocalStore> {
  try {
    const raw = await fs.readFile(ORDERS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as LocalStore;
    // 向后兼容：旧版文件没有 transfers 字段
    if (!parsed.transfers) parsed.transfers = {};
    return parsed;
  } catch {
    return { rules: {}, orders: {}, transfers: {} };
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

// 解析数据库连接串：
// 优先使用 DATABASE_URL；若未设置但存在 Vercel Postgres 的 POSTGRES_URL，则自动采用
function resolveDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

// 是否有数据库连接
function hasDatabase(): boolean {
  return !!resolveDatabaseUrl();
}

// 获取数据库连接
function getSql() {
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(url);
}

// ====== 按 externalCode 把 OrderItem[] 聚合成 OutboundOrder[] ======
// 聚合 key = externalCode + 收货门店 + 收件人 + 电话 + 地址
// 同一 externalCode 下不同门店会被拆成多个 outbound_order（卡片式文件常见）
// 同一门店不同 SKU 合并为同一条 outbound_order
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function groupItemsIntoOutboundOrders(items: OrderItem[]): OutboundOrder[] {
  const groups = new Map<string, OutboundOrder>();

  for (const item of items) {
    // 用 (externalCode + 门店 + 收件人 + 电话 + 地址) 作为聚合 key
    // 这样同一运单号下的多门店数据会拆为多条 outbound_order
    const parts = [
      item.externalCode || "",
      item.storeName || "",
      item.recipientName || "",
      item.recipientPhone || "",
      item.recipientAddress || "",
    ];
    const key = parts.some((p) => p.trim())
      ? parts.join("|")
      : "__no_code__";
    if (!groups.has(key)) {
      const idHash = Math.abs(
        parts.join("|").split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)
      ).toString(36);
      groups.set(key, {
        id: `out_${idHash}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

  // 顶层：调拨单（transfer 模式）。1 调拨单 = 1 外部编码
  await sql`
    CREATE TABLE IF NOT EXISTS transfer_orders (
      id TEXT PRIMARY KEY,
      external_code TEXT NOT NULL,
      remark TEXT,
      source_file TEXT,
      source_sheet TEXT,
      rule_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_transfer_external_code ON transfer_orders(external_code)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_external_code ON transfer_orders(external_code)`;

  // 父表：出库单 / 调拨明细
  // transfer 模式下：每行有 transfer_order_id FK
  // outbound 模式下：transfer_order_id 为 NULL
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
      transfer_order_id TEXT REFERENCES transfer_orders(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ
    )
  `;

  // 迁移：给已存在的 outbound_orders 添加 transfer_order_id 列（幂等）
  await sql`
    ALTER TABLE outbound_orders
    ADD COLUMN IF NOT EXISTS transfer_order_id TEXT REFERENCES transfer_orders(id) ON DELETE CASCADE
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_outbound_transfer_id ON outbound_orders(transfer_order_id)`;

  // 迁移：给已存在的 outbound_orders 添加 batch_id 列（幂等；空 externalCode 时按 batch 聚合）
  await sql`
    ALTER TABLE outbound_orders
    ADD COLUMN IF NOT EXISTS batch_id TEXT
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_outbound_batch_id ON outbound_orders(batch_id)`;

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
    batchId: (row.batch_id as string) || undefined,
    sourceFile: (row.source_file as string) || undefined,
    sourceSheet: (row.source_sheet as string) || undefined,
    sourceRow: row.source_row as number | undefined,
    ruleId: (row.rule_id as string) || undefined,
    status: (row.status as OutboundOrder["status"]) || "draft",
    transferOrderId: (row.transfer_order_id as string) || undefined,
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
    batchId: parent.batchId,
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

// ====== 调拨单聚合（按 externalCode+storeName 分组） ======
function groupItemsIntoOutboundOrdersByStore(
  items: OrderItem[]
): { transfer: TransferOrder | null; details: OutboundOrder[] }[] {
  // 第一层：按 externalCode 分组（一个调拨单）
  // 第二层：按 storeName 分组（一个调拨明细）
  const byCode = new Map<string, OrderItem[]>();
  for (const it of items) {
    const code = it.externalCode || "__no_code__";
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(it);
  }

  const result: { transfer: TransferOrder | null; details: OutboundOrder[] }[] = [];

  for (const [code, codeItems] of byCode) {
    // 第二层：按 storeName 分组
    const byStore = new Map<string, OrderItem[]>();
    for (const it of codeItems) {
      const store = (it.storeName || "").trim() || "__no_store__";
      if (!byStore.has(store)) byStore.set(store, []);
      byStore.get(store)!.push(it);
    }

    const details: OutboundOrder[] = [];
    for (const [store, storeItems] of byStore) {
      const first = storeItems[0];
      const detailId = `out_${code}_${store}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const detail: OutboundOrder = {
        id: detailId,
        externalCode: first.externalCode,
        storeName: first.storeName,
        recipientName: first.recipientName,
        recipientPhone: first.recipientPhone,
        recipientAddress: first.recipientAddress,
        remark: first.remark,
        batchId: first.batchId,
        sourceFile: first.sourceFile,
        sourceSheet: first.sourceSheet,
        sourceRow: first.sourceRow,
        ruleId: first.ruleId,
        status: first.status || "draft",
        items: storeItems.map((it) => ({ ...it, outboundOrderId: detailId })),
        createdAt: first.createdAt,
        submittedAt: first.submittedAt,
      };
      details.push(detail);
    }

    // 调拨单头
    const transfer: TransferOrder | null = code !== "__no_code__" ? {
      id: `trf_${code}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      externalCode: code,
      sourceFile: codeItems[0].sourceFile,
      sourceSheet: codeItems[0].sourceSheet,
      ruleId: codeItems[0].ruleId,
      status: codeItems[0].status || "draft",
      details,
      createdAt: codeItems[0].createdAt,
      submittedAt: codeItems[0].submittedAt,
    } : null;

    result.push({ transfer, details });
  }

  return result;
}

/**
 * 保存订单：接受 OrderItem[]，统一按 3 层结构落库
 *   transfer_order（1 外部编码 = 1 主表）
 *     → outbound_order（1 主表 + N 个门店 = N 条次表）
 *       → order_item（1 次表 + M 个 SKU = M 条明细）
 *
 * 这样同一运单号下的多门店数据会自然形成 rowspan 表格：
 *   1 外部编码 + N 行门店 + M 行 SKU
 *
 * 已存在同 externalCode 的 transfer → 覆盖（去重）
 */
export async function saveOrders(
  items: OrderItem[],
  _mode?: "outbound" | "transfer"
): Promise<{ savedOutbounds: number; savedTransfers: number }> {
  void _mode;
  if (items.length === 0) return { savedOutbounds: 0, savedTransfers: 0 };

  // 统一走 transfer 落库路径（即使 rule 是 outbound 模式也生成 3 层结构）
  return saveTransferOrders(items);
}

// ====== 调拨单落库：transfer_orders + outbound_orders + order_items ======
async function saveTransferOrders(items: OrderItem[]): Promise<{ savedOutbounds: number; savedTransfers: number }> {
  const groups = groupItemsIntoOutboundOrdersByStore(items);
  let savedTransfers = 0;
  let savedOutbounds = 0;

  if (!hasDatabase()) {
    const store = await readLocalStore();
    for (const { transfer, details } of groups) {
      for (const detail of details) {
        store.orders[detail.id] = detail;
        savedOutbounds++;
      }
      if (transfer) {
        store.transfers[transfer.id] = transfer;
        savedTransfers++;
      }
    }
    await writeLocalStore(store);
    return { savedOutbounds, savedTransfers };
  }

  const sql = getSql();
  const now = new Date().toISOString();

  for (const { transfer, details } of groups) {
    // 1. UPSERT 调拨单头
    let transferId: string | null = null;
    if (transfer) {
      const tRes = await sql`
        INSERT INTO transfer_orders (
          id, external_code, source_file, source_sheet, rule_id, status, created_at, submitted_at
        ) VALUES (
          ${transfer.id},
          ${transfer.externalCode},
          ${transfer.sourceFile || null},
          ${transfer.sourceSheet || null},
          ${transfer.ruleId || null},
          ${transfer.status || "draft"},
          ${transfer.createdAt || now},
          ${transfer.submittedAt || null}
        )
        ON CONFLICT (external_code) DO UPDATE SET
          source_file = EXCLUDED.source_file,
          source_sheet = EXCLUDED.source_sheet,
          rule_id = EXCLUDED.rule_id,
          status = EXCLUDED.status,
          submitted_at = EXCLUDED.submitted_at
        RETURNING id
      `;
      transferId = (tRes as Record<string, unknown>[])[0]?.id as string || transfer.id;
      savedTransfers++;
    }

    // 2. UPSERT 每个调拨明细
    for (const detail of details) {
      const obRes = await sql`
        INSERT INTO outbound_orders (
          id, external_code, store_name, recipient_name, recipient_phone,
          recipient_address, remark, source_file, source_sheet, source_row,
          rule_id, status, transfer_order_id, batch_id, created_at, submitted_at
        ) VALUES (
          ${detail.id},
          ${detail.externalCode || null},
          ${detail.storeName || null},
          ${detail.recipientName || null},
          ${detail.recipientPhone || null},
          ${detail.recipientAddress || null},
          ${detail.remark || null},
          ${detail.sourceFile || null},
          ${detail.sourceSheet || null},
          ${detail.sourceRow || null},
          ${detail.ruleId || null},
          ${detail.status || "draft"},
          ${transferId},
          ${detail.batchId || null},
          ${detail.createdAt || now},
          ${detail.submittedAt || null}
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
          transfer_order_id = EXCLUDED.transfer_order_id,
          batch_id = EXCLUDED.batch_id,
          submitted_at = EXCLUDED.submitted_at
        RETURNING id
      `;
      const finalObId = (obRes as Record<string, unknown>[])[0]?.id as string || detail.id;
      savedOutbounds++;

      // 3. 清理旧 SKU 行
      await sql`DELETE FROM order_items WHERE outbound_order_id = ${finalObId}`;

      // 4. 插入新 SKU 行
      for (const item of detail.items) {
        await sql`
          INSERT INTO order_items (
            id, outbound_order_id, sku_code, sku_name, sku_quantity, sku_spec, source_row, errors
          ) VALUES (
            ${item.id},
            ${finalObId},
            ${item.skuCode},
            ${item.skuName},
            ${item.skuQuantity},
            ${item.skuSpec || null},
            ${item.sourceRow || null},
            ${item.errors ? JSON.stringify(item.errors) : null}
          )
        `;
      }
    }
  }

  return { savedOutbounds, savedTransfers };
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
}): Promise<{ orders: OutboundOrder[]; total: number; totalTransfers: number; totalOutbounds: number }> {
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
    if (params?.startDate) {
      const start = new Date(params.startDate + "T00:00:00");
      all = all.filter((o) => new Date(o.createdAt) >= start);
    }
    if (params?.endDate) {
      const end = new Date(params.endDate + "T23:59:59.999");
      all = all.filter((o) => new Date(o.createdAt) <= end);
    }
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const transferIds = new Set(all.map((o) => o.transferOrderId).filter(Boolean));
    const totalTransfers = transferIds.size;
    const totalOutbounds = all.filter((o) => !o.transferOrderId).length;
    return {
      orders: all.slice(offset, offset + pageSize),
      total: all.length,
      totalTransfers,
      totalOutbounds,
    };
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
    // 结束日期需要包含当天全天，所以使用 +1 day
    queryArgs.push(params.endDate);
    whereParts.push(`created_at < ($${queryArgs.length}::date + interval '1 day')`);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  // === 调拨单（主表）计数：按 external_code 过滤；recipient_name 走子单 EXISTS ===
  const transferConditions: string[] = [];
  const transferArgs: unknown[] = [];
  if (params?.externalCode) {
    transferArgs.push(`%${params.externalCode}%`);
    transferConditions.push(`external_code ILIKE $${transferArgs.length}`);
  }
  if (params?.recipientName) {
    transferArgs.push(`%${params.recipientName}%`);
    transferConditions.push(
      `id IN (SELECT transfer_order_id FROM outbound_orders WHERE recipient_name ILIKE $${transferArgs.length})`
    );
  }
  const transferWhereClause =
    transferConditions.length > 0 ? `WHERE ${transferConditions.join(" AND ")}` : "";
  const transferCountResult = await sql(
    `SELECT COUNT(*) as cnt FROM transfer_orders ${transferWhereClause}`,
    transferArgs
  ) as Record<string, unknown>[];
  const totalTransfers = Number(transferCountResult[0].cnt);

  // === 无主单出库单（独立父单）计数 ===
  const orphanConditions = [...whereParts, "transfer_order_id IS NULL"];
  const orphanWhereClause = `WHERE ${orphanConditions.join(" AND ")}`;
  const orphanCountResult = await sql(
    `SELECT COUNT(*) as cnt FROM outbound_orders ${orphanWhereClause}`,
    queryArgs
  ) as Record<string, unknown>[];
  const totalOutbounds = Number(orphanCountResult[0].cnt);

  // === 分页数据（仍按 outbound_orders 分页；客户端会聚合成调拨单） ===
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
    total: totalTransfers + totalOutbounds,
    totalTransfers,
    totalOutbounds,
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

/**
 * 删除调拨单（CASCADE 自动删除所有调拨明细 + SKU）
 * transfer_order_id = ? 的 outbound_orders + 它们的 order_items 都会被级联删除
 */
export async function deleteTransferOrder(id: string): Promise<boolean> {
  if (!hasDatabase()) {
    const store = await readLocalStore();
    // 1. 删除调拨单头
    const hadTransfer = !!store.transfers[id];
    if (hadTransfer) {
      delete store.transfers[id];
    }
    // 2. 级联删除所有属于该调拨单的明细
    let removed = 0;
    for (const ob of Object.values(store.orders)) {
      if (ob.transferOrderId === id) {
        delete store.orders[ob.id];
        removed++;
      }
    }
    await writeLocalStore(store);
    return hadTransfer || removed > 0;
  }
  const sql = getSql();
  await sql`DELETE FROM transfer_orders WHERE id = ${id}`;
  // 始终返回 true（幂等：不存在也视为成功）
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

  // 兜底：id 为空时生成一个，避免空 id 写入数据库后无法查询
  if (!rule.id) {
    rule.id = uuidv4();
  }

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
  if (!rule.id) {
    rule.id = uuidv4();
  }
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
