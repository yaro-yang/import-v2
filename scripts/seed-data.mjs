/**
 * V4 压测数据准备脚本
 * 用法：npx tsx scripts/seed-data.mjs
 *
 * 功能：
 * 1. 创建/清理 SKU 主数据表
 * 2. 插入 20,000 条 SKU 主数据
 * 3. 生成 10,000 行 Excel 压测文件
 * 4. 压测文件包含少量非法 SKU 用于验证错误定位
 */

import * as XLSX from "xlsx";
import { neon } from "@neondatabase/serverless";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DB_URL) {
  console.error("请设置 DATABASE_URL 或 POSTGRES_URL 环境变量");
  process.exit(1);
}

const sql = neon(DB_URL);
const TEST_DATA_DIR = path.join(process.cwd(), "test-data");
const TOTAL_SKUS = 20_000;
const TOTAL_ROWS = 10_000;
const BATCH_SIZE = 5000; // 大批次 UNNEST 插入，20,000 只需 4 轮

// ============================================================
// 工具函数
// ============================================================

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 脱敏手机号生成
function randomPhone() {
  const prefixes = ["139", "158", "137", "188", "176", "150", "159", "186"];
  const prefix = randomPick(prefixes);
  const suffix = String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
  return prefix + suffix;
}

// ============================================================
// 1. 创建表并清理旧数据
// ============================================================

async function initTables() {
  console.log("📋 初始化数据库表...");

  await sql`
    CREATE TABLE IF NOT EXISTS sku_master (
      sku_code TEXT PRIMARY KEY,
      sku_name TEXT NOT NULL,
      sku_spec TEXT,
      sku_unit TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_sku_master_sku_code ON sku_master(sku_code)`;

  // 清理旧数据
  const before = await sql`SELECT COUNT(*) as cnt FROM sku_master`;
  console.log(`  旧数据: ${before[0]?.cnt || 0} 条`);

  await sql`DELETE FROM sku_master`;
  console.log("  ✅ 旧数据已清理");
}

// ============================================================
// 2. 插入 20,000 条 SKU 主数据
// ============================================================

async function seedSkus() {
  console.log(`📦 开始插入 ${TOTAL_SKUS.toLocaleString()} 条 SKU 主数据...`);
  const startTime = Date.now();

  const units = ["件", "箱", "kg", "袋", "瓶", "包", "桶", "盒"];
  const specs = ["500g", "1kg", "250ml", "2L", "100g", "200ml", "5kg", "10kg"];
  const namePrefixes = ["冷冻", "冷藏", "常温", "干货", "调味品", "肉禽", "蔬菜", "水果"];

  let count = 0;
  for (let i = 0; i < TOTAL_SKUS; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, TOTAL_SKUS);
    const batch = [];

    for (let j = i; j < batchEnd; j++) {
      const skuNum = j + 1;
      batch.push({
        sku_code: `SKU_${String(skuNum).padStart(5, "0")}`,
        sku_name: `${randomPick(namePrefixes)}商品${skuNum}`,
        sku_spec: randomPick(specs),
        sku_unit: randomPick(units),
      });
    }

    // UNNEST 批量插入（避免逐条 INSERT 导致连接超时）
    const codes = batch.map((b) => b.sku_code);
    const names = batch.map((b) => b.sku_name);
    const specList = batch.map((b) => b.sku_spec);
    const unitList = batch.map((b) => b.sku_unit);

    await sql`
      INSERT INTO sku_master (sku_code, sku_name, sku_spec, sku_unit)
      SELECT * FROM unnest(
        ${codes}::text[], ${names}::text[], ${specList}::text[], ${unitList}::text[]
      )
      ON CONFLICT (sku_code) DO UPDATE
        SET sku_name = EXCLUDED.sku_name, sku_spec = EXCLUDED.sku_spec, sku_unit = EXCLUDED.sku_unit
    `;
    count += batch.length;

    if ((i / BATCH_SIZE) % 10 === 0) {
      console.log(`  进度: ${count.toLocaleString()} / ${TOTAL_SKUS.toLocaleString()}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  ✅ 完成! 插入 ${count.toLocaleString()} 条, 耗时 ${elapsed}s`);
}

// ============================================================
// 3. 生成 10,000 行 Excel 压测文件
// ============================================================

async function generateExcelFile() {
  console.log(`📊 生成 ${TOTAL_ROWS.toLocaleString()} 行 Excel 压测文件...`);

  // 先获取 SKU 列表用于随机抽取
  const skuRows = await sql`
    SELECT sku_code, name, spec, unit FROM sku_master ORDER BY RANDOM() LIMIT 5000
  `;

  const skuCodes = skuRows.map((s) => s.sku_code);
  // 加入少量非法 SKU
  const illegalSkus = ["INVALID_SKU_001", "INVALID_SKU_002", "FAKE_SKU_999", "NOT_EXIST_SKU", "BAD_SKU_888"];

  const storeNames = [
    "海口龙湖天街店", "三亚凤凰机场店", "北京朝阳大悦城店", "上海南京路店",
    "广州天河城店", "深圳万象城店", "成都太古里店", "杭州西湖银泰店",
    "武汉光谷广场店", "南京新街口店",
  ];

  const recipients = [
    "张明", "李华", "王芳", "赵磊", "陈静",
    "刘洋", "孙丽", "周强", "吴敏", "郑涛",
    "钱琳", "马超", "黄莉", "林峰", "何雪",
  ];

  const remarks = [
    "", "急单请优先处理", "周末配送", "工作日配送",
    "放前台", "放门卫处", "电话联系后配送", "指定配送时间:14:00-16:00",
  ];

  // 生成数据行
  const rows = [];
  for (let i = 1; i <= TOTAL_ROWS; i++) {
    const isIllegal = i <= 50 && i % 10 === 0; // 前50行中有5个非法SKU

    const externalCode = `EXT${String(i).padStart(8, "0")}`;
    const storeName = randomPick(storeNames);
    const recipientName = randomPick(recipients);
    const recipientPhone = randomPhone();
    const recipientAddress = `XX省XX市XX区XX路${randomInt(1, 999)}号`;

    // 每行1-3个SKU
    const skuCount = randomInt(1, 3);
    for (let s = 0; s < skuCount; s++) {
      const skuCode = isIllegal && s === 0
        ? randomPick(illegalSkus)
        : randomPick(skuCodes);

      const skuName = isIllegal && s === 0
        ? "非法SKU商品"
        : skuRows.find((r) => r.sku_code === skuCode)?.name || "未知商品";

      const skuSpec = skuRows.find((r) => r.sku_code === skuCode)?.spec || "500g";
      const skuUnit = skuRows.find((r) => r.sku_code === skuCode)?.unit || "件";

      rows.push({
        外部编码: s === 0 ? externalCode : "",
        收货门店: s === 0 ? storeName : "",
        收件人: s === 0 ? recipientName : "",
        收件人电话: s === 0 ? recipientPhone : "",
        收件人地址: s === 0 ? recipientAddress : "",
        SKU编码: skuCode,
        SKU名称: skuName,
        SKU数量: String(randomInt(1, 100)),
        SKU规格: skuSpec,
        SKU单位: skuUnit,
        备注: s === 0 ? randomPick(remarks) : "",
      });
    }
  }

  // 生成 Excel
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // 设置列宽
  ws["!cols"] = [
    { wch: 15 }, // 外部编码
    { wch: 18 }, // 收货门店
    { wch: 10 }, // 收件人
    { wch: 15 }, // 收件人电话
    { wch: 30 }, // 收件人地址
    { wch: 15 }, // SKU编码
    { wch: 20 }, // SKU名称
    { wch: 10 }, // SKU数量
    { wch: 10 }, // SKU规格
    { wch: 10 }, // SKU单位
    { wch: 20 }, // 备注
  ];

  XLSX.utils.book_append_sheet(wb, ws, "出库单");

  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }

  const filePath = path.join(TEST_DATA_DIR, "10000-orders.xlsx");
  XLSX.writeFile(wb, filePath);

  console.log(`  ✅ 生成文件: ${filePath}`);
  console.log(`     实际数据行: ${rows.length.toLocaleString()} (含 ${TOTAL_ROWS} 个外部编码)`);
  console.log(`     非法SKU: ${illegalSkus.join(", ")} (分布在前50行)`);
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log("🚀 V4 压测数据准备脚本\n");

  try {
    await initTables();
    await seedSkus();
    await generateExcelFile();

    console.log("\n✅ 全部完成!");
    console.log(`   SKU 主数据: ${TOTAL_SKUS.toLocaleString()} 条`);
    console.log(`   压测文件: ${path.join(TEST_DATA_DIR, "10000-orders.xlsx")}`);
    console.log(`   总数据行: ~${(TOTAL_ROWS * 2).toLocaleString()} 行 (含多SKU展开)`);
  } catch (error) {
    console.error("❌ 失败:", error);
    process.exit(1);
  }

  process.exit(0);
}

main();
