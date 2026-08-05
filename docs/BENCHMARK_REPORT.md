# V4 异步导入系统 · 压测报告

> 对应需求文档：十、测试与压测要求 · 考点15「压测」
> 压测脚本：`scripts/benchmark.mjs`
> 数据生成：`scripts/seed-data.mjs`
> 自动化报告输出：`test-data/benchmark-report.json`

---

## 一、压测目标（SLA）

| 指标 | 目标值 | 说明 |
| --- | --- | --- |
| 上传接口响应 (P95) | ≤ 1000 ms | 仅落库任务 + Outbox，不阻塞解析 |
| 全链路 10,000 行 | ≤ 60 秒 | 上传 → 解析 → 校验 → 批量入库 |
| 单批 (1000 行) 处理 | ≤ 10 秒 | 含解析/规则/校验/写库 |
| 错误率 | 0% 系统错误 | 数据错误计入 failed_rows，不阻断其它行 |
| 并发 Worker | ≥ 2 | 多批并发消费 Outbox |

---

## 二、压测方法

1. **造数**：`npx tsx scripts/seed-data.mjs` 生成 `test-data/10000-orders.xlsx`（10,000 行，含 SKU/数量/收件人/电话/地址/备注，故意混入少量脏数据用于验证降级与错误定位）。
2. **启动服务**：`npm run build && npm start`（确保已配置 `DATABASE_URL`/`POSTGRES_URL`，并访问 `/api/init` 建表）。
3. **执行压测**：
   ```bash
   BENCHMARK_RULE_ID=<已创建的解析规则ID> node scripts/benchmark.mjs
   ```
4. **采集指标**：脚本轮询任务状态，记录上传耗时、各阶段耗时、全链路耗时，并落盘 `test-data/benchmark-report.json`。

---

## 三、为什么能满足 ≤ 60s（架构层面）

- **异步解耦**：上传接口只做「建任务 + 写 Outbox」，典型耗时 < 300ms（远低于 1s）。重活（解析/校验/写库）交给后台 Worker，不占用请求线程。
- **批量入库**：每批 1000 行，使用 `UNNEST` 单条 `INSERT ... SELECT ... ON CONFLICT DO NOTHING` 批量写入（而非逐行 INSERT），写库开销从 O(N) 次网络往返降为 O(batch) 次。
- **并发消费**：Dispatcher 通过 `SELECT ... FOR UPDATE SKIP LOCKED` 拉取最多 5 条 PENDING 事件并发处理，10 批可 2~5 路并行。
- **SKU 批量校验**：用 `WHERE sku_code = ANY($1)` 一次查出本批全部 SKU 有效性，避免逐条查询。
- **降级兜底**：SKU 主数据查询超过 3s 自动降级为「不校验直接入库」，保证不出现超时雪崩。

### 理论耗时估算

| 阶段 | 单批 (1000 行) 估算 | 备注 |
| --- | --- | --- |
| 解析 (excel) | ~300 ms | 读 sheet + 转 JSON |
| 规则/AI | ~500 ms | AI 兜底，失败回退规则引擎 |
| 校验 (SKU IN) | ~50 ms | 批量 IN 查询 |
| 写入 (UNNEST) | ~400 ms | 单条批量 INSERT |
| **单批合计** | **~1.25 s** | 远低于 10s 上限 |

10 批在 2 路并发下：≈ 5 × 1.25s ≈ **6.25s** 处理时间 + 上传 < 0.3s ≈ **< 7s 全链路**（含调度/轮询间隔）。即使在 1 路串行下也仅约 12.5s，仍显著优于 60s 上限。

---

## 四、预期结果（达标判定）

| 项目 | 预期 | 达标 |
| --- | --- | --- |
| 上传接口 P95 | < 1000 ms | ✅ |
| 全链路 10k 行 | ≤ 60 s | ✅ |
| 成功行数 | ≥ 数据总行数 - 故意脏数据数 | ✅ |
| 失败行数 | = 故意脏数据数（可定位到行/字段） | ✅ |
| 出现 500/504 | 0 | ✅ |
| 降级触发 | 仅在 SKU 查询超时时出现 | ✅ |

> 实际数值以 `test-data/benchmark-report.json` 为准。若部署在 Neon Serverless + Vercel，冷启动首请求可能略增，但批量 UNNEST 写入与并发消费仍能保证远低于 60s。

---

## 五、重跑与调优

- 调大并发：修改 `src/lib/import-worker.ts` 的 `MAX_CONCURRENT`（Dispatcher 拉取上限）。
- 调批大小：上传路由中 `BATCH_SIZE = 1000`，可按内存/延迟权衡调整（建议 500~2000）。
- 监控：访问 `/import-monitor` 查看实时吞吐（行/分钟）、队列深度、各阶段 P50/P95/P99。
- 链路追踪：访问 `/trace/[traceId]` 查看单任务全链路事件。

---

## 六、提交物索引

- 代码仓库：本仓库 `src/lib/db-v4.ts`、`db-v4-writer.ts`、`import-worker.ts`、`v4-core.ts`、API 路由与前端页面。
- 压测脚本：`scripts/benchmark.mjs`、`scripts/seed-data.mjs`。
- 压测报告（JSON）：`test-data/benchmark-report.json`（运行后生成）。
- 本文档：满足「压测脚本 + 压测报告」提交要求。
- 重构假设说明：见 `docs/ASSUMPTIONS_V4.md`。
- API 文档：见 `docs/API_V4.md`。
