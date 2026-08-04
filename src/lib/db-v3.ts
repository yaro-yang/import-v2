// V3 数据库操作层
// 独立的 V3 表结构，不直接访问 V2 的业务表
// 运单数据通过接口从 V2 同步到本地快照表

import { neon } from "@neondatabase/serverless";
import { v4 as uuidv4 } from "uuid";
import { promises as fs } from "fs";
import * as path from "path";
import {
  WaybillSnapshot, ApiSyncLog, ExceptionTicket, ApprovalRecord,
  CompensationRecord, InventoryRecord, ScanRecord, QCRule,
  TicketStatus, ExceptionType, QCResult, BatchStatus,
  CompensationDirection, ExecutionAction, ExceptionSource,
  ApprovalAction, ApprovalTrigger,
} from "@/types";
import { DEFAULT_CONFIG } from "./config";
import { getDefaultQCRules } from "./qc-engine";

const DATA_DIR = path.join(process.cwd(), ".data");
const V3_FILE = path.join(DATA_DIR, "v3-data.json");

interface V3LocalStore {
  waybillSnapshots: Record<string, WaybillSnapshot>;
  apiSyncLogs: Record<string, ApiSyncLog>;
  exceptionTickets: Record<string, ExceptionTicket>;
  approvalRecords: Record<string, ApprovalRecord>;
  compensationRecords: Record<string, CompensationRecord>;
  inventory: Record<string, InventoryRecord>;
  scanRecords: Record<string, ScanRecord>;
  qcRules: Record<string, QCRule>;
  approvalConfig: Record<string, string>;
  ticket_seq: number;
}

async function readV3Store(): Promise<V3LocalStore> {
  try {
    const raw = await fs.readFile(V3_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      waybillSnapshots: {},
      apiSyncLogs: {},
      exceptionTickets: {},
      approvalRecords: {},
      compensationRecords: {},
      inventory: {},
      scanRecords: {},
      qcRules: {},
      approvalConfig: {},
      ticket_seq: 0,
    };
  }
}

async function writeV3Store(store: V3LocalStore): Promise<void> {
  if (process.env.VERCEL === "1") {
    throw new Error("Vercel deployment requires DATABASE_URL for V3 data storage");
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(V3_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function hasDatabase(): boolean {
  return !!(
    process.env.DATABASE_URL ||
    (typeof process !== "undefined" &&
      process.env &&
      (process.env as Record<string, string>).DATABASE_URL)
  );
}

function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(url);
}

// ====== 数据库初始化 ======
export async function initV3DB() {
  if (!hasDatabase()) return;

  const sql = getSql();

  // 运单本地快照表
  await sql`
    CREATE TABLE IF NOT EXISTS waybill_snapshots (
      id TEXT PRIMARY KEY,
      waybill_id TEXT NOT NULL,
      external_code TEXT,
      store_name TEXT,
      recipient_name TEXT,
      recipient_phone TEXT,
      recipient_address TEXT,
      total_amount DECIMAL(12,2) DEFAULT 0,
      sku_count INTEGER DEFAULT 0,
      raw_data JSONB,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data_version INTEGER DEFAULT 1
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_waybill_id ON waybill_snapshots(waybill_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_external_code ON waybill_snapshots(external_code)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_snapshots_waybill_id ON waybill_snapshots(waybill_id)`;

  // 接口同步日志表
  await sql`
    CREATE TABLE IF NOT EXISTS api_sync_logs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      api_name TEXT NOT NULL,
      request_params JSONB,
      response_status INTEGER,
      response_summary TEXT,
      duration_ms INTEGER,
      success BOOLEAN NOT NULL DEFAULT false,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_sync_logs_request_id ON api_sync_logs(request_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON api_sync_logs(created_at DESC)`;

  // 异常工单表
  await sql`
    CREATE TABLE IF NOT EXISTS exception_tickets (
      id TEXT PRIMARY KEY,
      ticket_no TEXT NOT NULL UNIQUE,
      waybill_snapshot_id TEXT REFERENCES waybill_snapshots(id),
      exception_type TEXT NOT NULL,
      exception_source TEXT NOT NULL DEFAULT 'manual',
      description TEXT,
      amount DECIMAL(12,2) DEFAULT 0,
      reporter TEXT NOT NULL,
      reporter_role TEXT DEFAULT 'operator',
      status TEXT NOT NULL DEFAULT 'pending',
      current_level INTEGER DEFAULT 0,
      reject_count INTEGER DEFAULT 0,
      max_reject_count INTEGER DEFAULT 3,
      execution_action TEXT,
      timeout_at TIMESTAMPTZ,
      version INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tickets_ticket_no ON exception_tickets(ticket_no)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tickets_status ON exception_tickets(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tickets_reporter ON exception_tickets(reporter)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tickets_exception_type ON exception_tickets(exception_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tickets_waybill_snapshot ON exception_tickets(waybill_snapshot_id)`;

  // 审批记录表
  await sql`
    CREATE TABLE IF NOT EXISTS approval_records (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES exception_tickets(id),
      ticket_no TEXT NOT NULL,
      approver TEXT NOT NULL,
      approver_role TEXT,
      level INTEGER NOT NULL,
      action TEXT NOT NULL,
      opinion TEXT,
      triggered_by TEXT DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_approval_ticket_id ON approval_records(ticket_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_approval_approver ON approval_records(approver)`;

  // 赔付记录表
  await sql`
    CREATE TABLE IF NOT EXISTS compensation_records (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES exception_tickets(id),
      approval_record_id TEXT REFERENCES approval_records(id),
      compensation_direction TEXT NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_compensation_ticket_id ON compensation_records(ticket_id)`;

  // 库存表
  await sql`
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL,
      sku_name TEXT,
      warehouse TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      locked_quantity INTEGER DEFAULT 0,
      available_quantity INTEGER GENERATED ALWAYS AS (quantity - locked_quantity) STORED,
      batch_no TEXT,
      status TEXT DEFAULT 'available',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_inventory_sku_code ON inventory(sku_code)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_sku_batch ON inventory(sku_code, COALESCE(batch_no, ''))`;

  // 扫描记录表
  await sql`
    CREATE TABLE IF NOT EXISTS scan_records (
      id TEXT PRIMARY KEY,
      waybill_snapshot_id TEXT REFERENCES waybill_snapshots(id),
      external_code TEXT,
      sku_code TEXT NOT NULL,
      sku_name TEXT,
      batch_no TEXT,
      scan_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      operator TEXT NOT NULL,
      device_id TEXT,
      qc_result TEXT NOT NULL,
      fail_reason TEXT,
      triggered_rule_id TEXT,
      triggered_rule_name TEXT,
      batch_status TEXT DEFAULT 'normal',
      ticket_id TEXT REFERENCES exception_tickets(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_scan_waybill ON scan_records(waybill_snapshot_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scan_sku ON scan_records(sku_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scan_ticket ON scan_records(ticket_id)`;

  // 品控规则表
  await sql`
    CREATE TABLE IF NOT EXISTS qc_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      exception_sub_type TEXT NOT NULL,
      condition_field TEXT NOT NULL,
      condition_operator TEXT NOT NULL,
      condition_value TEXT NOT NULL,
      severity TEXT NOT NULL,
      auto_create_ticket BOOLEAN DEFAULT true,
      approval_level INTEGER DEFAULT 1,
      enabled BOOLEAN DEFAULT true,
      priority INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // 审批配置表
  await sql`
    CREATE TABLE IF NOT EXISTS approval_config (
      id TEXT PRIMARY KEY,
      config_key TEXT NOT NULL UNIQUE,
      config_value TEXT NOT NULL,
      description TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("V3 database initialized");
}

// ====== 初始化默认配置 ======
export async function initDefaultConfig() {
  if (!hasDatabase()) {
    const store = await readV3Store();
    // 初始化工单序号
    if (!store.ticket_seq) store.ticket_seq = 0;

    // 初始化品控规则
    if (Object.keys(store.qcRules).length === 0) {
      const defaults = getDefaultQCRules();
      for (const rule of defaults) {
        const id = uuidv4();
        store.qcRules[id] = { ...rule, id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      }
    }

    // 初始化审批配置
    if (Object.keys(store.approvalConfig).length === 0) {
      store.approvalConfig = {
        level2_threshold: String(DEFAULT_CONFIG.approval.level2Threshold),
        level1_timeout_hours: String(DEFAULT_CONFIG.timeout.level1ReviewHours),
        level2_timeout_hours: String(DEFAULT_CONFIG.timeout.level2ReviewHours),
        pending_timeout_hours: String(DEFAULT_CONFIG.timeout.pendingTimeoutHours),
        max_reject_count: String(DEFAULT_CONFIG.resubmit.maxRejectCount),
        qc_hold_timeout_hours: String(DEFAULT_CONFIG.qcHold.timeoutHours),
      };
    }

    await writeV3Store(store);
    return;
  }

  const sql = getSql();

  // 初始化品控规则
  const existingRules = await sql`SELECT COUNT(*) as cnt FROM qc_rules`;
  if (Number((existingRules as Record<string, unknown>[])[0]?.cnt || 0) === 0) {
    const defaults = getDefaultQCRules();
    for (const rule of defaults) {
      await sql`
        INSERT INTO qc_rules (id, name, exception_sub_type, condition_field, condition_operator, condition_value, severity, auto_create_ticket, approval_level, enabled, priority)
        VALUES (${uuidv4()}, ${rule.name}, ${rule.exceptionSubType}, ${rule.conditionField}, ${rule.conditionOperator}, ${rule.conditionValue}, ${rule.severity}, ${rule.autoCreateTicket}, ${rule.approvalLevel}, ${rule.enabled}, ${rule.priority})
      `;
    }
  }

  // 初始化审批配置
  const existingConfig = await sql`SELECT COUNT(*) as cnt FROM approval_config`;
  if (Number((existingConfig as Record<string, unknown>[])[0]?.cnt || 0) === 0) {
    const configs = [
      { key: "level2_threshold", value: String(DEFAULT_CONFIG.approval.level2Threshold), desc: "二级审批金额阈值(元)" },
      { key: "level1_timeout_hours", value: String(DEFAULT_CONFIG.timeout.level1ReviewHours), desc: "一级审批超时时长(小时)" },
      { key: "level2_timeout_hours", value: String(DEFAULT_CONFIG.timeout.level2ReviewHours), desc: "二级审批超时时长(小时)" },
      { key: "pending_timeout_hours", value: String(DEFAULT_CONFIG.timeout.pendingTimeoutHours), desc: "待审批超时时长(小时)" },
      { key: "max_reject_count", value: String(DEFAULT_CONFIG.resubmit.maxRejectCount), desc: "最大重提次数" },
      { key: "qc_hold_timeout_hours", value: String(DEFAULT_CONFIG.qcHold.timeoutHours), desc: "品控暂扣超时时长(小时)" },
    ];
    for (const c of configs) {
      await sql`
        INSERT INTO approval_config (id, config_key, config_value, description)
        VALUES (${uuidv4()}, ${c.key}, ${c.value}, ${c.desc})
      `;
    }
  }
}

// ====== 运单快照操作 ======
export async function upsertWaybillSnapshot(snapshot: Omit<WaybillSnapshot, "id">): Promise<WaybillSnapshot> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    const existing = Object.values(store.waybillSnapshots).find((s) => s.waybillId === snapshot.waybillId);
    const id = existing?.id || uuidv4();
    const record: WaybillSnapshot = { ...snapshot, id };
    store.waybillSnapshots[id] = record;
    await writeV3Store(store);
    return record;
  }

  const sql = getSql();
  const result = await sql`
    INSERT INTO waybill_snapshots (id, waybill_id, external_code, store_name, recipient_name, recipient_phone, recipient_address, total_amount, sku_count, raw_data, synced_at, data_version)
    VALUES (${uuidv4()}, ${snapshot.waybillId}, ${snapshot.externalCode || null}, ${snapshot.storeName || null}, ${snapshot.recipientName || null}, ${snapshot.recipientPhone || null}, ${snapshot.recipientAddress || null}, ${snapshot.totalAmount}, ${snapshot.skuCount}, ${JSON.stringify(snapshot.rawData)}, ${snapshot.syncedAt}, ${snapshot.dataVersion || 1})
    ON CONFLICT (waybill_id) DO UPDATE SET
      external_code = EXCLUDED.external_code,
      store_name = EXCLUDED.store_name,
      recipient_name = EXCLUDED.recipient_name,
      recipient_phone = EXCLUDED.recipient_phone,
      recipient_address = EXCLUDED.recipient_address,
      total_amount = EXCLUDED.total_amount,
      sku_count = EXCLUDED.sku_count,
      raw_data = EXCLUDED.raw_data,
      synced_at = EXCLUDED.synced_at,
      data_version = waybill_snapshots.data_version + 1
    RETURNING *
  `;
  const row = (result as Record<string, unknown>[])[0];
  return mapSnapshotRow(row);
};

export async function getWaybillSnapshot(waybillId: string): Promise<WaybillSnapshot | null> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    const s = Object.values(store.waybillSnapshots).find((s) => s.waybillId === waybillId);
    return s || null;
  }
  const sql = getSql();
  const result = await sql`SELECT * FROM waybill_snapshots WHERE waybill_id = ${waybillId}`;
  const rows = result as Record<string, unknown>[];
  return rows.length > 0 ? mapSnapshotRow(rows[0]) : null;
}

export async function getWaybillSnapshotByExternalCode(externalCode: string): Promise<WaybillSnapshot[]> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    return Object.values(store.waybillSnapshots).filter((s) => s.externalCode === externalCode);
  }
  const sql = getSql();
  const result = await sql`SELECT * FROM waybill_snapshots WHERE external_code = ${externalCode}`;
  return (result as Record<string, unknown>[]).map(mapSnapshotRow);
}

function mapSnapshotRow(row: Record<string, unknown>): WaybillSnapshot {
  return {
    id: row.id as string,
    waybillId: row.waybill_id as string,
    externalCode: (row.external_code as string) || undefined,
    storeName: (row.store_name as string) || undefined,
    recipientName: (row.recipient_name as string) || undefined,
    recipientPhone: (row.recipient_phone as string) || undefined,
    recipientAddress: (row.recipient_address as string) || undefined,
    totalAmount: Number(row.total_amount) || 0,
    skuCount: Number(row.sku_count) || 0,
    rawData: typeof row.raw_data === "string" ? JSON.parse(row.raw_data as string) : (row.raw_data || {}),
    syncedAt: row.synced_at as string,
    dataVersion: Number(row.data_version) || 1,
  };
}

// ====== 接口同步日志操作 ======
export async function saveApiSyncLog(log: ApiSyncLog): Promise<void> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    store.apiSyncLogs[log.id] = log;
    // 只保留最近100条
    const logs = Object.values(store.apiSyncLogs).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (logs.length > 100) {
      const toKeep = logs.slice(0, 100);
      store.apiSyncLogs = {};
      for (const l of toKeep) store.apiSyncLogs[l.id] = l;
    }
    await writeV3Store(store);
    return;
  }
  const sql = getSql();
  await sql`
    INSERT INTO api_sync_logs (id, request_id, api_name, request_params, response_status, response_summary, duration_ms, success, error_message)
    VALUES (${log.id}, ${log.requestId}, ${log.apiName}, ${JSON.stringify(log.requestParams)}, ${log.responseStatus || null}, ${log.responseSummary || null}, ${log.durationMs}, ${log.success}, ${log.errorMessage || null})
  `;
}

export async function getSyncStats(): Promise<{
  totalCalls: number; successCalls: number; failedCalls: number;
  lastSyncTime: string | null; successRate: number; recentLogs: ApiSyncLog[];
}> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    const logs = Object.values(store.apiSyncLogs).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const total = logs.length;
    const success = logs.filter((l) => l.success).length;
    return {
      totalCalls: total,
      successCalls: success,
      failedCalls: total - success,
      lastSyncTime: logs.length > 0 ? logs[0].createdAt : null,
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      recentLogs: logs.slice(0, 20),
    };
  }
  const sql = getSql();
  const totalResult = await sql`SELECT COUNT(*) as cnt FROM api_sync_logs`;
  const successResult = await sql`SELECT COUNT(*) as cnt FROM api_sync_logs WHERE success = true`;
  const lastResult = await sql`SELECT created_at FROM api_sync_logs ORDER BY created_at DESC LIMIT 1`;
  const recentResult = await sql`SELECT * FROM api_sync_logs ORDER BY created_at DESC LIMIT 20`;

  const total = Number((totalResult as Record<string, unknown>[])[0]?.cnt || 0);
  const success = Number((successResult as Record<string, unknown>[])[0]?.cnt || 0);
  const lastRows = lastResult as Record<string, unknown>[];

  return {
    totalCalls: total,
    successCalls: success,
    failedCalls: total - success,
    lastSyncTime: lastRows.length > 0 ? (lastRows[0].created_at as string) : null,
    successRate: total > 0 ? Math.round((success / total) * 100) : 0,
    recentLogs: (recentResult as Record<string, unknown>[]).map(mapSyncLogRow),
  };
}

function mapSyncLogRow(row: Record<string, unknown>): ApiSyncLog {
  return {
    id: row.id as string,
    requestId: row.request_id as string,
    apiName: row.api_name as string,
    requestParams: typeof row.request_params === "string" ? JSON.parse(row.request_params as string) : (row.request_params as Record<string, unknown> || {}),
    responseStatus: row.response_status as number | undefined,
    responseSummary: (row.response_summary as string) || undefined,
    durationMs: Number(row.duration_ms) || 0,
    success: !!row.success,
    errorMessage: (row.error_message as string) || undefined,
    createdAt: row.created_at as string,
  };
}

// ====== 异常工单操作 ======
export async function createTicket(data: {
  waybillSnapshotId?: string;
  exceptionType: ExceptionType;
  exceptionSource: ExceptionSource;
  description: string;
  amount: number;
  reporter: string;
  reporterRole: string;
}): Promise<ExceptionTicket> {
  const now = new Date().toISOString();
  const ticketId = uuidv4();

  if (!hasDatabase()) {
    const store = await readV3Store();
    store.ticket_seq++;
    const ticketNo = `TK${String(store.ticket_seq).padStart(6, "0")}`;

    // 查重：同一运单 + 同类型 + 未关闭工单
    const duplicate = Object.values(store.exceptionTickets).find(
      (t) =>
        t.waybillSnapshotId === data.waybillSnapshotId &&
        t.exceptionType === data.exceptionType &&
        !["completed", "rejected_final"].includes(t.status)
    );
    if (duplicate) {
      throw new Error(`该运单已存在同类型未关闭工单：${duplicate.ticketNo}（状态：${duplicate.status}）`);
    }

    const ticket: ExceptionTicket = {
      id: ticketId,
      ticketNo,
      waybillSnapshotId: data.waybillSnapshotId,
      exceptionType: data.exceptionType,
      exceptionSource: data.exceptionSource,
      description: data.description,
      amount: data.amount,
      reporter: data.reporter,
      reporterRole: data.reporterRole,
      status: "pending",
      currentLevel: 0,
      rejectCount: 0,
      maxRejectCount: Number(store.approvalConfig.max_reject_count || DEFAULT_CONFIG.resubmit.maxRejectCount),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.exceptionTickets[ticketId] = ticket;
    await writeV3Store(store);
    return ticket;
  }

  const sql = getSql();

  // 查重
  const dupCheck = await sql`
    SELECT ticket_no, status FROM exception_tickets
    WHERE waybill_snapshot_id = ${data.waybillSnapshotId || null}
      AND exception_type = ${data.exceptionType}
      AND status NOT IN ('completed', 'rejected_final')
    LIMIT 1
  `;
  if ((dupCheck as Record<string, unknown>[]).length > 0) {
    const dup = (dupCheck as Record<string, unknown>[])[0];
    throw new Error(`该运单已存在同类型未关闭工单：${dup.ticket_no}（状态：${dup.status}）`);
  }

  // 生成工单号
  const seqResult = await sql`SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_no FROM 3) AS INTEGER)), 0) + 1 as next_seq FROM exception_tickets`;
  const nextSeq = Number((seqResult as Record<string, unknown>[])[0]?.next_seq || 1);
  const ticketNo = `TK${String(nextSeq).padStart(6, "0")}`;

  const maxReject = await getConfigValue("max_reject_count");
  const result = await sql`
    INSERT INTO exception_tickets (id, ticket_no, waybill_snapshot_id, exception_type, exception_source, description, amount, reporter, reporter_role, status, current_level, reject_count, max_reject_count, version, timeout_at)
    VALUES (${ticketId}, ${ticketNo}, ${data.waybillSnapshotId || null}, ${data.exceptionType}, ${data.exceptionSource}, ${data.description}, ${data.amount}, ${data.reporter}, ${data.reporterRole}, 'pending', 0, 0, ${maxReject}, 1, ${null})
    RETURNING *
  `;
  return mapTicketRow((result as Record<string, unknown>[])[0]);
}

function mapTicketRow(row: Record<string, unknown>): ExceptionTicket {
  return {
    id: row.id as string,
    ticketNo: row.ticket_no as string,
    waybillSnapshotId: (row.waybill_snapshot_id as string) || undefined,
    exceptionType: row.exception_type as ExceptionType,
    exceptionSource: (row.exception_source as ExceptionSource) || "manual",
    description: (row.description as string) || "",
    amount: Number(row.amount) || 0,
    reporter: row.reporter as string,
    reporterRole: (row.reporter_role as string) || "operator",
    status: row.status as TicketStatus,
    currentLevel: Number(row.current_level) || 0,
    rejectCount: Number(row.reject_count) || 0,
    maxRejectCount: Number(row.max_reject_count) || 3,
    executionAction: (row.execution_action as ExecutionAction) || undefined,
    timeoutAt: (row.timeout_at as string) || undefined,
    version: Number(row.version) || 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getTickets(params: {
  status?: TicketStatus;
  exceptionType?: ExceptionType;
  waybillCode?: string;
  approver?: string;
  reporter?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ tickets: ExceptionTicket[]; total: number }> {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  if (!hasDatabase()) {
    const store = await readV3Store();
    let tickets = Object.values(store.exceptionTickets);

    if (params.status) tickets = tickets.filter((t) => t.status === params.status);
    if (params.exceptionType) tickets = tickets.filter((t) => t.exceptionType === params.exceptionType);
    if (params.waybillCode) {
      const snapshots = Object.values(store.waybillSnapshots)
        .filter((s) => (s.externalCode || "").includes(params.waybillCode!))
        .map((s) => s.id);
      tickets = tickets.filter((t) => t.waybillSnapshotId && snapshots.includes(t.waybillSnapshotId));
    }
    if (params.reporter) tickets = tickets.filter((t) => t.reporter === params.reporter);

    tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // 加载关联的快照数据
    for (const t of tickets.slice(offset, offset + pageSize)) {
      if (t.waybillSnapshotId) {
        t.waybillSnapshot = store.waybillSnapshots[t.waybillSnapshotId];
      }
    }

    return {
      tickets: tickets.slice(offset, offset + pageSize),
      total: tickets.length,
    };
  }

  const sql = getSql();
  const whereParts: string[] = [];
  const args: unknown[] = [];

  if (params.status) {
    args.push(params.status);
    whereParts.push(`t.status = $${args.length}`);
  }
  if (params.exceptionType) {
    args.push(params.exceptionType);
    whereParts.push(`t.exception_type = $${args.length}`);
  }
  if (params.waybillCode) {
    args.push(`%${params.waybillCode}%`);
    whereParts.push(`EXISTS (SELECT 1 FROM waybill_snapshots ws WHERE ws.id = t.waybill_snapshot_id AND ws.external_code ILIKE $${args.length})`);
  }
  if (params.reporter) {
    args.push(params.reporter);
    whereParts.push(`t.reporter = $${args.length}`);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const countResult = await sql(
    `SELECT COUNT(*) as cnt FROM exception_tickets t ${whereClause}`, args
  );

  const pageArgs = [...args, pageSize, offset];
  const dataResult = await sql(
    `SELECT t.* FROM exception_tickets t ${whereClause} ORDER BY t.created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    pageArgs
  );

  const tickets = (dataResult as Record<string, unknown>[]).map(mapTicketRow);

  // 批量加载快照
  const snapshotIds = tickets.map((t) => t.waybillSnapshotId).filter(Boolean) as string[];
  if (snapshotIds.length > 0) {
    const snapshots = await sql`SELECT * FROM waybill_snapshots WHERE id = ANY(${snapshotIds})`;
    const snapshotMap = new Map<string, WaybillSnapshot>();
    for (const s of snapshots as Record<string, unknown>[]) {
      snapshotMap.set(s.id as string, mapSnapshotRow(s));
    }
    for (const t of tickets) {
      if (t.waybillSnapshotId) {
        t.waybillSnapshot = snapshotMap.get(t.waybillSnapshotId);
      }
    }
  }

  return {
    tickets,
    total: Number((countResult as Record<string, unknown>[])[0]?.cnt || 0),
  };
}

export async function getTicketById(id: string): Promise<ExceptionTicket | null> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    const ticket = store.exceptionTickets[id];
    if (!ticket) return null;
    if (ticket.waybillSnapshotId) {
      ticket.waybillSnapshot = store.waybillSnapshots[ticket.waybillSnapshotId];
    }
    ticket.approvalRecords = Object.values(store.approvalRecords)
      .filter((r) => r.ticketId === id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const comp = Object.values(store.compensationRecords).find((r) => r.ticketId === id);
    if (comp) ticket.compensationRecord = comp;
    return ticket;
  }

  const sql = getSql();
  const result = await sql`SELECT * FROM exception_tickets WHERE id = ${id}`;
  const rows = result as Record<string, unknown>[];
  if (rows.length === 0) return null;

  const ticket = mapTicketRow(rows[0]);

  if (ticket.waybillSnapshotId) {
    const snapResult = await sql`SELECT * FROM waybill_snapshots WHERE id = ${ticket.waybillSnapshotId}`;
    const snapRows = snapResult as Record<string, unknown>[];
    if (snapRows.length > 0) ticket.waybillSnapshot = mapSnapshotRow(snapRows[0]);
  }

  const approvalResult = await sql`SELECT * FROM approval_records WHERE ticket_id = ${id} ORDER BY created_at`;
  ticket.approvalRecords = (approvalResult as Record<string, unknown>[]).map(mapApprovalRow);

  const compResult = await sql`SELECT * FROM compensation_records WHERE ticket_id = ${id} LIMIT 1`;
  const compRows = compResult as Record<string, unknown>[];
  if (compRows.length > 0) ticket.compensationRecord = mapCompensationRow(compRows[0]);

  return ticket;
}

export async function updateTicketStatus(
  id: string,
  status: TicketStatus,
  currentLevel: number,
  currentVersion: number,
  extra?: { timeoutAt?: string; rejectCount?: number; executionAction?: ExecutionAction }
): Promise<{ success: boolean; error?: string }> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    const ticket = store.exceptionTickets[id];
    if (!ticket) return { success: false, error: "工单不存在" };
    if (ticket.version !== currentVersion) {
      return { success: false, error: "该工单已被处理，请刷新" };
    }
    ticket.status = status;
    ticket.currentLevel = currentLevel;
    ticket.version++;
    ticket.updatedAt = new Date().toISOString();
    if (extra?.timeoutAt) ticket.timeoutAt = extra.timeoutAt;
    if (extra?.rejectCount !== undefined) ticket.rejectCount = extra.rejectCount;
    if (extra?.executionAction) ticket.executionAction = extra.executionAction;
    await writeV3Store(store);
    return { success: true };
  }

  const sql = getSql();
  const result = await sql`
    UPDATE exception_tickets SET
      status = ${status},
      current_level = ${currentLevel},
      version = version + 1,
      updated_at = NOW(),
      timeout_at = ${extra?.timeoutAt || null}::timestamptz,
      reject_count = ${extra?.rejectCount !== undefined ? extra.rejectCount : undefined},
      execution_action = ${extra?.executionAction || null}
    WHERE id = ${id} AND version = ${currentVersion}
    RETURNING id
  `;
  if ((result as Record<string, unknown>[]).length === 0) {
    return { success: false, error: "该工单已被处理，请刷新" };
  }
  return { success: true };
}

// ====== 审批记录操作 ======
export async function createApprovalRecord(record: Omit<ApprovalRecord, "id" | "createdAt">): Promise<ApprovalRecord> {
  const id = uuidv4();
  const now = new Date().toISOString();

  // 幂等检查：同一工单同一审批人同一层级同一动作已存在
  if (!hasDatabase()) {
    const store = await readV3Store();
    const dup = Object.values(store.approvalRecords).find(
      (r) => r.ticketId === record.ticketId && r.approver === record.approver && r.action === record.action
    );
    if (dup) {
      throw new Error("重复审批操作，该审批已存在");
    }
  } else {
    const sql = getSql();
    const dupCheck = await sql`
      SELECT id FROM approval_records
      WHERE ticket_id = ${record.ticketId} AND approver = ${record.approver} AND action = ${record.action}
      LIMIT 1
    `;
    if ((dupCheck as Record<string, unknown>[]).length > 0) {
      throw new Error("重复审批操作，该审批已存在");
    }
  }

  if (!hasDatabase()) {
    const store = await readV3Store();
    const approvalRecord: ApprovalRecord = { ...record, id, createdAt: now };
    store.approvalRecords[id] = approvalRecord;
    await writeV3Store(store);
    return approvalRecord;
  }

  const sql = getSql();
  await sql`
    INSERT INTO approval_records (id, ticket_id, ticket_no, approver, approver_role, level, action, opinion, triggered_by)
    VALUES (${id}, ${record.ticketId}, ${record.ticketNo}, ${record.approver}, ${record.approverRole}, ${record.level}, ${record.action}, ${record.opinion || null}, ${record.triggeredBy})
  `;
  return { ...record, id, createdAt: now };
}

function mapApprovalRow(row: Record<string, unknown>): ApprovalRecord {
  return {
    id: row.id as string,
    ticketId: row.ticket_id as string,
    ticketNo: row.ticket_no as string,
    approver: row.approver as string,
    approverRole: (row.approver_role as string) || "",
    level: Number(row.level) || 0,
    action: row.action as ApprovalAction,
    opinion: (row.opinion as string) || undefined,
    triggeredBy: (row.triggered_by as ApprovalTrigger) || "manual",
    createdAt: row.created_at as string,
  };
}

// ====== 赔付记录操作 ======
export async function createCompensationRecord(data: {
  ticketId: string;
  approvalRecordId?: string;
  compensationDirection: CompensationDirection;
  amount: number;
  description?: string;
}): Promise<CompensationRecord> {
  const id = uuidv4();
  const now = new Date().toISOString();

  // 幂等：同一工单唯一赔付记录
  if (!hasDatabase()) {
    const store = await readV3Store();
    const dup = Object.values(store.compensationRecords).find((r) => r.ticketId === data.ticketId);
    if (dup) throw new Error("该工单赔付记录已存在");
  } else {
    const sql = getSql();
    const dupCheck = await sql`SELECT id FROM compensation_records WHERE ticket_id = ${data.ticketId} LIMIT 1`;
    if ((dupCheck as Record<string, unknown>[]).length > 0) {
      throw new Error("该工单赔付记录已存在");
    }
  }

  if (!hasDatabase()) {
    const store = await readV3Store();
    const record: CompensationRecord = { ...data, id, status: "pending", createdAt: now };
    store.compensationRecords[id] = record;
    await writeV3Store(store);
    return record;
  }

  const sql = getSql();
  await sql`
    INSERT INTO compensation_records (id, ticket_id, approval_record_id, compensation_direction, amount, status, description)
    VALUES (${id}, ${data.ticketId}, ${data.approvalRecordId || null}, ${data.compensationDirection}, ${data.amount}, 'pending', ${data.description || null})
  `;
  return { ...data, id, status: "pending", createdAt: now };
}

function mapCompensationRow(row: Record<string, unknown>): CompensationRecord {
  return {
    id: row.id as string,
    ticketId: row.ticket_id as string,
    approvalRecordId: (row.approval_record_id as string) || undefined,
    compensationDirection: row.compensation_direction as CompensationDirection,
    amount: Number(row.amount) || 0,
    status: (row.status as "pending" | "processed") || "pending",
    description: (row.description as string) || undefined,
    createdAt: row.created_at as string,
  };
}

// ====== 库存操作 ======
export async function getInventory(skuCode: string, batchNo?: string): Promise<InventoryRecord | null> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    const record = Object.values(store.inventory).find(
      (i) => i.skuCode === skuCode && (i.batchNo || "") === (batchNo || "")
    );
    return record || null;
  }
  const sql = getSql();
  const result = await sql`
    SELECT * FROM inventory WHERE sku_code = ${skuCode} AND COALESCE(batch_no, '') = COALESCE(${batchNo || null}, '')
    LIMIT 1
  `;
  const rows = result as Record<string, unknown>[];
  return rows.length > 0 ? mapInventoryRow(rows[0]) : null;
}

export async function updateInventory(
  skuCode: string,
  batchNo: string | undefined,
  changes: { quantityDelta?: number; lockedDelta?: number; status?: string }
): Promise<void> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    let record = Object.values(store.inventory).find(
      (i) => i.skuCode === skuCode && (i.batchNo || "") === (batchNo || "")
    );
    if (!record) {
      record = {
        id: uuidv4(),
        skuCode,
        batchNo,
        quantity: 0,
        lockedQuantity: 0,
        availableQuantity: 0,
        status: "available",
        updatedAt: new Date().toISOString(),
      };
    }
    if (changes.quantityDelta) record.quantity += changes.quantityDelta;
    if (changes.lockedDelta) record.lockedQuantity += changes.lockedDelta;
    record.availableQuantity = record.quantity - record.lockedQuantity;
    if (changes.status) record.status = changes.status as "available" | "qc_hold" | "locked";
    record.updatedAt = new Date().toISOString();
    store.inventory[record.id] = record;
    await writeV3Store(store);
    return;
  }

  const sql = getSql();
  const existing = await sql`
    SELECT id, quantity, locked_quantity FROM inventory
    WHERE sku_code = ${skuCode} AND COALESCE(batch_no, '') = COALESCE(${batchNo || null}, '')
    LIMIT 1
  `;
  const rows = existing as Record<string, unknown>[];

  if (rows.length === 0) {
    await sql`
      INSERT INTO inventory (id, sku_code, batch_no, quantity, locked_quantity, status)
      VALUES (${uuidv4()}, ${skuCode}, ${batchNo || null}, ${Math.max(0, changes.quantityDelta || 0)}, ${Math.max(0, changes.lockedDelta || 0)}, ${changes.status || 'available'})
    `;
  } else {
    const updates: string[] = ["updated_at = NOW()"];
    if (changes.quantityDelta) updates.push(`quantity = GREATEST(0, quantity + ${changes.quantityDelta})`);
    if (changes.lockedDelta) updates.push(`locked_quantity = GREATEST(0, locked_quantity + ${changes.lockedDelta})`);
    if (changes.status) updates.push(`status = '${changes.status}'`);
    await sql(`UPDATE inventory SET ${updates.join(", ")} WHERE id = '${rows[0].id}'`);
  }
}

function mapInventoryRow(row: Record<string, unknown>): InventoryRecord {
  return {
    id: row.id as string,
    skuCode: row.sku_code as string,
    skuName: (row.sku_name as string) || undefined,
    warehouse: (row.warehouse as string) || undefined,
    quantity: Number(row.quantity) || 0,
    lockedQuantity: Number(row.locked_quantity) || 0,
    availableQuantity: Number(row.available_quantity) || 0,
    batchNo: (row.batch_no as string) || undefined,
    status: (row.status as "available" | "qc_hold" | "locked") || "available",
    updatedAt: row.updated_at as string,
  };
}

// ====== 扫描记录操作 ======
export async function createScanRecord(data: {
  waybillSnapshotId?: string;
  externalCode?: string;
  skuCode: string;
  skuName?: string;
  batchNo?: string;
  operator: string;
  deviceId?: string;
  qcResult: QCResult;
  failReason?: string;
  triggeredRuleId?: string;
  triggeredRuleName?: string;
  batchStatus: BatchStatus;
  ticketId?: string;
}): Promise<ScanRecord> {
  const id = uuidv4();
  const now = new Date().toISOString();

  if (!hasDatabase()) {
    const store = await readV3Store();

    const record: ScanRecord = {
      ...data,
      id,
      scanTime: now,
      createdAt: now,
    };
    store.scanRecords[id] = record;
    await writeV3Store(store);
    return record;
  }

  const sql = getSql();
  await sql`
    INSERT INTO scan_records (id, waybill_snapshot_id, external_code, sku_code, sku_name, batch_no, scan_time, operator, device_id, qc_result, fail_reason, triggered_rule_id, triggered_rule_name, batch_status, ticket_id)
    VALUES (${id}, ${data.waybillSnapshotId || null}, ${data.externalCode || null}, ${data.skuCode}, ${data.skuName || null}, ${data.batchNo || null}, ${now}, ${data.operator}, ${data.deviceId || null}, ${data.qcResult}, ${data.failReason || null}, ${data.triggeredRuleId || null}, ${data.triggeredRuleName || null}, ${data.batchStatus}, ${data.ticketId || null})
  `;
  return { ...data, id, scanTime: now, createdAt: now };
}

export async function getScanRecords(waybillSnapshotId: string): Promise<ScanRecord[]> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    return Object.values(store.scanRecords)
      .filter((r) => r.waybillSnapshotId === waybillSnapshotId)
      .sort((a, b) => new Date(b.scanTime).getTime() - new Date(a.scanTime).getTime());
  }
  const sql = getSql();
  const result = await sql`
    SELECT * FROM scan_records WHERE waybill_snapshot_id = ${waybillSnapshotId} ORDER BY scan_time DESC
  `;
  return (result as Record<string, unknown>[]).map(mapScanRow);
}

export async function hasOpenScanTicket(waybillSnapshotId: string, skuCode: string): Promise<{ exists: boolean; ticketId?: string; ticketNo?: string }> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    const scans = Object.values(store.scanRecords).filter(
      (r) => r.waybillSnapshotId === waybillSnapshotId && r.skuCode === skuCode && r.ticketId
    );
    for (const scan of scans) {
      if (!scan.ticketId) continue;
      const ticket = store.exceptionTickets[scan.ticketId];
      if (ticket && !["completed", "rejected_final"].includes(ticket.status)) {
        return { exists: true, ticketId: ticket.id, ticketNo: ticket.ticketNo };
      }
    }
    return { exists: false };
  }
  const sql = getSql();
  const result = await sql`
    SELECT sr.ticket_id, t.ticket_no, t.status
    FROM scan_records sr
    JOIN exception_tickets t ON sr.ticket_id = t.id
    WHERE sr.waybill_snapshot_id = ${waybillSnapshotId}
      AND sr.sku_code = ${skuCode}
      AND sr.ticket_id IS NOT NULL
      AND t.status NOT IN ('completed', 'rejected_final')
    LIMIT 1
  `;
  const rows = result as Record<string, unknown>[];
  if (rows.length > 0) {
    return {
      exists: true,
      ticketId: rows[0].ticket_id as string,
      ticketNo: rows[0].ticket_no as string,
    };
  }
  return { exists: false };
}

function mapScanRow(row: Record<string, unknown>): ScanRecord {
  return {
    id: row.id as string,
    waybillSnapshotId: (row.waybill_snapshot_id as string) || undefined,
    externalCode: (row.external_code as string) || undefined,
    skuCode: row.sku_code as string,
    skuName: (row.sku_name as string) || undefined,
    batchNo: (row.batch_no as string) || undefined,
    scanTime: row.scan_time as string,
    operator: row.operator as string,
    deviceId: (row.device_id as string) || undefined,
    qcResult: row.qc_result as QCResult,
    failReason: (row.fail_reason as string) || undefined,
    triggeredRuleId: (row.triggered_rule_id as string) || undefined,
    triggeredRuleName: (row.triggered_rule_name as string) || undefined,
    batchStatus: (row.batch_status as BatchStatus) || "normal",
    ticketId: (row.ticket_id as string) || undefined,
    createdAt: row.created_at as string,
  };
}

// ====== 品控规则操作 ======
export async function getQCRules(): Promise<QCRule[]> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    return Object.values(store.qcRules).sort((a, b) => a.priority - b.priority);
  }
  const sql = getSql();
  const result = await sql`SELECT * FROM qc_rules ORDER BY priority ASC`;
  return (result as Record<string, unknown>[]).map(mapQCRuleRow);
}

export async function saveQCRule(rule: Omit<QCRule, "createdAt" | "updatedAt" | "id"> & { id?: string }): Promise<QCRule> {
  const id = rule.id || uuidv4();
  const now = new Date().toISOString();

  if (!hasDatabase()) {
    const store = await readV3Store();
    const record: QCRule = { ...rule, id, createdAt: now, updatedAt: now };
    store.qcRules[id] = record;
    await writeV3Store(store);
    return record;
  }

  const sql = getSql();
  await sql`
    INSERT INTO qc_rules (id, name, exception_sub_type, condition_field, condition_operator, condition_value, severity, auto_create_ticket, approval_level, enabled, priority, updated_at)
    VALUES (${id}, ${rule.name}, ${rule.exceptionSubType}, ${rule.conditionField}, ${rule.conditionOperator}, ${rule.conditionValue}, ${rule.severity}, ${rule.autoCreateTicket}, ${rule.approvalLevel}, ${rule.enabled}, ${rule.priority}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      exception_sub_type = EXCLUDED.exception_sub_type,
      condition_field = EXCLUDED.condition_field,
      condition_operator = EXCLUDED.condition_operator,
      condition_value = EXCLUDED.condition_value,
      severity = EXCLUDED.severity,
      auto_create_ticket = EXCLUDED.auto_create_ticket,
      approval_level = EXCLUDED.approval_level,
      enabled = EXCLUDED.enabled,
      priority = EXCLUDED.priority,
      updated_at = ${now}
  `;
  return { ...rule, id, createdAt: now, updatedAt: now };
}

export async function deleteQCRule(id: string): Promise<boolean> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    if (store.qcRules[id]) {
      delete store.qcRules[id];
      await writeV3Store(store);
      return true;
    }
    return false;
  }
  const sql = getSql();
  await sql`DELETE FROM qc_rules WHERE id = ${id}`;
  return true;
}

function mapQCRuleRow(row: Record<string, unknown>): QCRule {
  return {
    id: row.id as string,
    name: row.name as string,
    exceptionSubType: row.exception_sub_type as ExceptionType,
    conditionField: row.condition_field as string,
    conditionOperator: row.condition_operator as QCRule["conditionOperator"],
    conditionValue: row.condition_value as string,
    severity: (row.severity as QCRule["severity"]) || "medium",
    autoCreateTicket: row.auto_create_ticket !== false,
    approvalLevel: Number(row.approval_level) || 1,
    enabled: row.enabled !== false,
    priority: Number(row.priority) || 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ====== 配置操作 ======
export async function getConfigValue(key: string): Promise<string> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    return store.approvalConfig[key] || "";
  }
  const sql = getSql();
  const result = await sql`SELECT config_value FROM approval_config WHERE config_key = ${key}`;
  const rows = result as Record<string, unknown>[];
  return rows.length > 0 ? (rows[0].config_value as string) : "";
}

export async function getAllConfig(): Promise<Record<string, string>> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    return { ...store.approvalConfig };
  }
  const sql = getSql();
  const result = await sql`SELECT * FROM approval_config`;
  const config: Record<string, string> = {};
  for (const row of result as Record<string, unknown>[]) {
    config[row.config_key as string] = row.config_value as string;
  }
  return config;
}

export async function updateConfig(key: string, value: string): Promise<void> {
  if (!hasDatabase()) {
    const store = await readV3Store();
    store.approvalConfig[key] = value;
    await writeV3Store(store);
    return;
  }
  const sql = getSql();
  await sql`
    INSERT INTO approval_config (id, config_key, config_value, updated_at)
    VALUES (${uuidv4()}, ${key}, ${value}, NOW())
    ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
  `;
}

// ====== 批量生成模拟数据 ======
export async function generateMockTickets(count: number): Promise<number> {
  const exceptionTypes: ExceptionType[] = ["lost", "damaged", "rejected", "timeout", "address_error", "qc_quantity", "qc_appearance", "qc_spec", "qc_label", "qc_batch"];
  const statuses: TicketStatus[] = ["pending", "level1_review", "level2_review", "executing", "completed"];
  const reporters = ["user_op_01", "user_qc_01"];
  const now = new Date();
  let created = 0;

  for (let i = 0; i < count; i++) {
    const type = exceptionTypes[i % exceptionTypes.length];
    const status = statuses[i % statuses.length];
    const reporter = reporters[i % reporters.length];
    const isQC = type.startsWith("qc_");
    const source: ExceptionSource = isQC ? "scan_trigger" : "manual";

    // Create a snapshot for tracking
    const snapshotId = uuidv4();
    const snapshot: WaybillSnapshot = {
      id: snapshotId,
      waybillId: `out_mock_${i}`,
      externalCode: `MOCK${String(i).padStart(6, "0")}`,
      storeName: `门店${i % 10 + 1}`,
      recipientName: `收件人${i + 1}`,
      recipientPhone: `138${String(i).padStart(8, "0")}`,
      recipientAddress: `测试地址${i + 1}号`,
      totalAmount: Math.round(Math.random() * 10000 * 100) / 100,
      skuCount: Math.floor(Math.random() * 10) + 1,
      rawData: {},
      syncedAt: now.toISOString(),
      dataVersion: 1,
    };

    if (!hasDatabase()) {
      const store = await readV3Store();
      store.waybillSnapshots[snapshotId] = snapshot;
      store.ticket_seq++;
      const ticketNo = `TK${String(store.ticket_seq).padStart(6, "0")}`;
      const ticket: ExceptionTicket = {
        id: uuidv4(),
        ticketNo,
        waybillSnapshotId: snapshotId,
        exceptionType: type,
        exceptionSource: source,
        description: `模拟${isQC ? "品控" : "物流"}异常工单 - ${type}`,
        amount: snapshot.totalAmount,
        reporter,
        reporterRole: isQC ? "qc_supervisor" : "operator",
        status,
        currentLevel: status === "level2_review" ? 2 : status === "level1_review" ? 1 : 0,
        rejectCount: 0,
        maxRejectCount: 3,
        version: 1,
        createdAt: new Date(now.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: now.toISOString(),
      };
      store.exceptionTickets[ticket.id] = ticket;
      await writeV3Store(store);
    } else {
      const sql = getSql();
      const seqResult = await sql`SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_no FROM 3) AS INTEGER)), 0) + 1 as next_seq FROM exception_tickets`;
      const nextSeq = Number((seqResult as Record<string, unknown>[])[0]?.next_seq || 1) + i;
      const ticketNo = `TK${String(nextSeq).padStart(6, "0")}`;

      await sql`
        INSERT INTO waybill_snapshots (id, waybill_id, external_code, store_name, recipient_name, recipient_phone, recipient_address, total_amount, sku_count, raw_data, synced_at)
        VALUES (${snapshotId}, ${snapshot.waybillId}, ${snapshot.externalCode || null}, ${snapshot.storeName || null}, ${snapshot.recipientName || null}, ${snapshot.recipientPhone || null}, ${snapshot.recipientAddress || null}, ${snapshot.totalAmount}, ${snapshot.skuCount}, '{}'::jsonb, ${snapshot.syncedAt})
        ON CONFLICT (waybill_id) DO NOTHING
      `;

      await sql`
        INSERT INTO exception_tickets (id, ticket_no, waybill_snapshot_id, exception_type, exception_source, description, amount, reporter, reporter_role, status, current_level, reject_count, max_reject_count, version)
        VALUES (${uuidv4()}, ${ticketNo}, ${snapshotId}, ${type}, ${source}, ${`模拟异常工单 - ${type}`}, ${snapshot.totalAmount}, ${reporter}, ${isQC ? "qc_supervisor" : "operator"}, ${status}, ${status === "level2_review" ? 2 : status === "level1_review" ? 1 : 0}, 0, 3, 1)
      `;
    }
    created++;
  }
  return created;
}
