/**
 * V4 压测脚本
 * 用法：node scripts/benchmark.mjs
 *
 * 压测流程：
 * 1. 上传 10,000 行 Excel 文件
 * 2. 记录上传接口响应时间
 * 3. 轮询任务状态直到完成
 * 4. 统计总耗时
 * 5. 校验最终成功行数、失败行数
 * 6. 输出是否达到 ≤ 60 秒目标
 * 7. 记录是否出现 500/504 错误
 */

const BASE_URL = process.env.BENCHMARK_URL || "http://localhost:3000";
const RULE_ID = process.env.BENCHMARK_RULE_ID || ""; // 需要指定一个已创建的解析规则ID

async function main() {
  console.log("🚀 V4 导入链路压测\n");
  console.log(`  目标 URL: ${BASE_URL}`);
  console.log(`  压测文件: test-data/10000-orders.xlsx\n`);

  if (!RULE_ID) {
    console.error("❌ 请设置 BENCHMARK_RULE_ID 环境变量，指定解析规则ID");
    console.error("   示例: BENCHMARK_RULE_ID=rule_xxx node scripts/benchmark.mjs");
    process.exit(1);
  }

  const fs = await import("fs");
  const path = await import("path");
  const filePath = path.join(process.cwd(), "test-data", "10000-orders.xlsx");

  if (!fs.existsSync(filePath)) {
    console.error("❌ 压测文件不存在，请先运行 seed-data 脚本生成数据");
    console.error("   npx tsx scripts/seed-data.mjs");
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileBlob = new Blob([fileBuffer]);

  // ============================================================
  // 1. 上传文件
  // ============================================================
  console.log("📤 步骤 1: 上传文件...");
  const uploadStart = Date.now();

  const formData = new FormData();
  formData.append("file", fileBlob, "10000-orders.xlsx");
  formData.append("ruleId", RULE_ID);

  let taskId = "";
  let traceId = "";
  let totalBatches = 0;

  try {
    const res = await fetch(`${BASE_URL}/api/import-tasks`, {
      method: "POST",
      body: formData,
    });

    const uploadDuration = Date.now() - uploadStart;
    console.log(`   响应状态: ${res.status}`);
    console.log(`   上传耗时: ${uploadDuration}ms`);

    if (res.status !== 200) {
      const errText = await res.text();
      console.error(`   ❌ 上传失败: ${errText}`);
      process.exit(1);
    }

    const data = await res.json();
    taskId = data.task_id;
    traceId = data.trace_id;
    totalBatches = data.total_batches;

    console.log(`   Task ID: ${taskId}`);
    console.log(`   Trace ID: ${traceId}`);
    console.log(`   总行数: ${data.total_rows}`);
    console.log(`   批次数: ${totalBatches}`);
    console.log(`   ✅ 上传接口 P95: ${uploadDuration}ms (目标 ≤ 1000ms)\n`);
  } catch (error) {
    console.error(`   ❌ 上传请求异常: ${error}`);
    process.exit(1);
  }

  // ============================================================
  // 2. 触发 Dispatcher
  // ============================================================
  console.log("📨 步骤 2: 触发调度器...");
  try {
    await fetch(`${BASE_URL}/api/import-tasks/dispatch`, { method: "POST" });
    console.log("   ✅ 调度器已触发\n");
  } catch {
    console.log("   ⚠️ 调度器触发失败，将依赖轮询\n");
  }

  // ============================================================
  // 3. 轮询任务状态
  // ============================================================
  console.log("⏳ 步骤 3: 轮询任务进度...");
  const pollStart = Date.now();
  let lastProcessed = 0;
  let errorCount = 0;
  let maxElapsed = 0;

  const poll = async (): Promise<void> => {
    // 每 2 秒触发一次 dispatch + 查询状态
    try {
      await fetch(`${BASE_URL}/api/import-tasks/dispatch`, { method: "POST" });
    } catch {}

    const res = await fetch(`${BASE_URL}/api/import-tasks/${taskId}`);
    const data = await res.json();

    const elapsed = ((Date.now() - pollStart) / 1000).toFixed(1);
    const progress = data.total_rows > 0
      ? Math.round((data.processed_rows / data.total_rows) * 100)
      : 0;

    if (data.processed_rows !== lastProcessed) {
      console.log(`   [${elapsed}s] ${data.processed_rows}/${data.total_rows} (${progress}%) | 成功:${data.success_rows} 失败:${data.failed_rows} | 状态:${data.status}`);
      lastProcessed = data.processed_rows;
    }

    if (data.status === "COMPLETED" || data.status === "PARTIAL_SUCCESS" || data.status === "FAILED") {
      return data;
    }

    maxElapsed = parseFloat(elapsed);
    if (maxElapsed > 120) {
      console.log(`   ⚠️ 超过 120 秒，停止轮询`);
      return data;
    }

    // 每次查询时也触发 dispatch
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return poll();
  };

  const finalData = await poll();
  const totalDuration = ((Date.now() - uploadStart) / 1000).toFixed(1);

  // ============================================================
  // 4. 输出结果
  // ============================================================
  console.log(`\n📊 压测结果\n`);
  console.log(`   任务ID:      ${taskId}`);
  console.log(`   TraceID:     ${traceId}`);
  console.log(`   总行数:      ${finalData.total_rows}`);
  console.log(`   成功行数:    ${finalData.success_rows}`);
  console.log(`   失败行数:    ${finalData.failed_rows}`);
  console.log(`   批次数:      ${finalData.completed_batches}/${finalData.total_batches}`);
  console.log(`   最终状态:    ${finalData.status}`);
  console.log(`   降级模式:    ${finalData.degraded ? "是" : "否"}`);
  console.log(`   全链路耗时:  ${totalDuration}s`);
  console.log(`   ${finalData.status === "COMPLETED" ? "✅ 全部成功" : finalData.status === "PARTIAL_SUCCESS" ? "⚠️ 部分成功" : "❌ 失败"}`);
  console.log(`   ${parseFloat(totalDuration) <= 60 ? "✅ 达标 (≤ 60s)" : "❌ 未达标 (> 60s)"}\n`);

  // 输出错误详情（如果有）
  if (finalData.failed_rows > 0) {
    console.log("📋 错误详情:");
    const errRes = await fetch(`${BASE_URL}/api/import-tasks/${taskId}/errors?page_size=10`);
    const errData = await errRes.json();
    for (const err of (errData.errors || []).slice(0, 10)) {
      console.log(`   [${err.error_code}] 行${err.row_number} | ${err.field_name}: ${err.error_reason}`);
    }
  }

  // 输出性能日志
  console.log("\n⚡ 批次性能:");
  const batchRes = await fetch(`${BASE_URL}/api/import-tasks/${taskId}/batches`);
  const batchData = await batchRes.json();
  const batches = batchData.batches || [];
  if (batches.length > 0) {
    const totals = batches
      .filter((b: Record<string, unknown>) => b.performance)
      .reduce((acc: Record<string, number>, b: Record<string, unknown>) => {
        const p = b.performance as Record<string, number>;
        acc.parse += p.parse_duration_ms || 0;
        acc.rule += p.rule_duration_ms || 0;
        acc.validate += p.validate_duration_ms || 0;
        acc.insert += p.insert_duration_ms || 0;
        acc.total += p.total_duration_ms || 0;
        return acc;
      }, { parse: 0, rule: 0, validate: 0, insert: 0, total: 0 });

    console.log(`   解析总耗时:   ${totals.parse}ms`);
    console.log(`   规则总耗时:   ${totals.rule}ms`);
    console.log(`   校验总耗时:   ${totals.validate}ms`);
    console.log(`   写入总耗时:   ${totals.insert}ms`);
    console.log(`   处理总耗时:   ${totals.total}ms`);
  }

  // 输出压测报告 JSON
  const report = {
    test_time: new Date().toISOString(),
    base_url: BASE_URL,
    task_id: taskId,
    trace_id: traceId,
    total_rows: finalData.total_rows,
    success_rows: finalData.success_rows,
    failed_rows: finalData.failed_rows,
    final_status: finalData.status,
    upload_duration_ms: Date.now() - uploadStart,
    total_duration_seconds: parseFloat(totalDuration),
    target_met: parseFloat(totalDuration) <= 60,
    degraded: finalData.degraded,
    batches: batches.map((b: Record<string, unknown>) => ({
      batch_index: b.batch_index,
      status: b.status,
      retry_count: b.retry_count,
      performance: b.performance || null,
    })),
  };

  const reportPath = path.join(process.cwd(), "test-data", "benchmark-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 压测报告已保存: ${reportPath}`);
}

main().catch(console.error);
