// 数据库初始化脚本
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_mVh6iMlYUyc4@ep-ancient-mode-apjafd5f-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";

const sql = neon(DATABASE_URL);

async function init() {
  console.log("Creating orders table...");
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
  console.log("  ✅ orders table ready");

  console.log("Creating rules table...");
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
  console.log("  ✅ rules table ready");

  console.log("Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_external_code ON orders(external_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_recipient_name ON orders(recipient_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`;
  console.log("  ✅ indexes ready");

  console.log("🎉 Database initialization complete!");
}

init().catch((e) => {
  console.error("❌ Database init failed:", e);
  process.exit(1);
});
