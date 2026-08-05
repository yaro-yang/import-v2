# V4 异步事件驱动重构 - 重构假设说明

## 1. 为什么选择异步事件驱动

V2 同步阻塞模式在 10,000 行场景下存在根本性瓶颈：
- Vercel Serverless 函数超时限制（免费版 60s），无法在一次请求中完成解析+校验+写入
- 逐行 INSERT 导致数据库连接池耗尽
- 用户无进度感知，体验极差

异步事件驱动的优势：
- 上传立即返回 task_id（P95 < 1s），用户体验流畅
- 后台分批并发处理，充分利用 Serverless 并行能力
- 每批独立可重试，故障隔离
- 全链路可追踪，故障 1 分钟内可定位

## 2. 处理单元大小设计

**批次大小：1,000 行/批**

推导：
- 单批 1,000 行的解析 + 规则 + 校验 + 写入在 Neon Serverless 上约 3-8 秒
- Vercel Serverless 单次函数执行限制 60s，1,000 行有充足余量
- 10,000 行 = 10 个批次，并发 2 个 Worker，理论完成时间 ≈ 5 * 8s = 40s
- 批次过小（500 行）会导致 Outbox 事件过多，数据库写入次数增加
- 批次过大（2,000 行）会增加单次函数内存和超时风险

## 3. Worker / Consumer 容量规划

- Worker 数量：2 个并发（Vercel Serverless 限制）
- 单 Worker 处理 1 个批次（1,000 行）
- 10,000 行 = 10 批次 / 2 Worker = 5 轮，每轮约 8s
- 预计全链路完成时间：5 * 8s = 40s（满足 ≤ 60s 目标）

对于更高吞吐（50,000 单/分钟），建议：
- 部署常驻 Worker 到 Railway/Render（解除 Vercel 并发限制）
- 增加 Worker 并发数至 5-10
- 使用 Redis 队列（BullMQ）替代 Outbox 轮询

## 4. 10,000 单/分钟性能推导

| 阶段 | 每批耗时 | 10批总耗时 | 说明 |
|---|---|---|---|
| 文件解析 | ~500ms | ~5s | 1,000 行 Excel 解析 |
| 规则引擎 | ~2,000ms | ~20s | 字段映射 + 类型转换 |
| SKU 校验 | ~1,000ms | ~10s | 批量 IN 查询，每批 1,000+ SKU |
| 批量写入 | ~2,000ms | ~20s | UPSERT 写入 outbound_orders + order_items |
| 进度/日志 | ~200ms | ~2s | 更新任务进度 + 性能日志 |
| **合计** | **~5,700ms** | **~57s** | **满足 ≤ 60s 目标** |

## 5. 数据库连接池和并发控制

- Neon PostgreSQL 免费版连接限制：~20 连接
- Worker 并发数：2
- 每 Worker 使用 1 个连接（复用 Neon 连接池）
- 峰值连接数：2 Worker + 1 API = 3 连接（安全范围内）

索引设计：
- sku_master.sku_code UNIQUE（加速 SKU 校验）
- import_task_batches(task_id, batch_index) UNIQUE（幂等保证）
- import_task_errors(task_id, batch_index)（错误查询）
- event_outbox(status, next_retry_at)（Dispatcher 轮询）
- trace_events(trace_id, occurred_at)（Trace 检索）

## 6. Outbox 可靠性保证

Transactional Outbox 模式：
- 任务创建 + 批次创建 + Outbox 事件写入在同一逻辑事务中
- Dispatcher 轮询 event_outbox，投递后标记为 SENT
- 如果服务宕机，Dispatcher 恢复后会重新投递 PENDING 事件
- 使用 FOR UPDATE SKIP LOCKED 避免重复投递

消息重复投递保护：
- 批次使用 task_id + batch_index 唯一约束
- Worker 锁定批次（UPDATE status = PROCESSING）防止重复处理
- 已完成批次再次消费时快速返回

## 7. 处理单元幂等

- 同一 task_id + batch_index 重复消费：
  - lockBatch 使用 UPDATE WHERE status = PENDING 原子操作
  - 已被其他 Worker 锁定的批次会跳过
- 数据库写入幂等：
  - outbound_orders 使用 external_code + store_name 去重
  - order_items 使用 ON CONFLICT DO NOTHING
- 进度累计幂等：
  - 使用 SQL 原子操作（processed_rows = processed_rows + delta）
  - 已完成批次不会重复累计

## 8. 部分行失败策略

部分行失败时，成功行继续入库（partial_success 状态）。

理由：
- 业务上，99% 的成功行不应因为 1% 的失败行而全部丢弃
- 用户可以在错误详情页查看失败行并单独修复
- 失败行写入 import_task_errors，支持按批次/错误码筛选和分页

## 9. SKU 校验降级

触发条件：
- SKU 批量查询耗时超过 3 秒
- 数据库连接失败

降级行为：
- 跳过 SKU 主数据校验，仅做本地格式校验（必填、电话格式、数量）
- 任务标记为 degraded = true
- 前端任务详情页明确提示"SKU 校验已降级"
- Trace 时间线记录降级事件

恢复：
- 服务恢复后，新任务自动恢复正常校验
- 降级任务不做后续补校验（避免复杂性）

## 10. 敏感数据脱敏

| 字段 | 脱敏方式 | 示例 |
|---|---|---|
| 手机号 | 保留前3后4 | 139****5678 |
| 地址 | 保留前6字符 | XX省XX市*** |
| 外部编码 | 不脱敏 | EXT00000001 |
| SKU编码 | 不脱敏 | SKU_00001 |

脱敏在写入 import_task_errors 时执行，原始文件不受影响。

## 11. 压测数据

生成方式：
```
npx tsx scripts/seed-data.mjs
```

清理方式：
- SKU 主数据：TRUNCATE sku_master
- 导入任务：DELETE FROM import_tasks WHERE created_at < NOW() - INTERVAL '7 days'
- 错误日志：随任务级联删除
- Outbox：DELETE FROM event_outbox WHERE created_at < NOW() - INTERVAL '1 day'
- 性能日志：随任务级联删除

## 12. 如果可以向产品经理/运维提问

1. 大促期间预期的并发上传数是多少？
2. 是否需要支持"同一文件重复上传"的去重策略？
3. 降级后的数据是否需要后续补校验？如果需要，补校验的触发条件是什么？
4. 错误数据的修复流程是什么？用户修复后重新上传还是在线编辑？
5. 监控告警的接收渠道（钉钉/企微/邮件）和阈值？
6. 是否需要支持导入任务的取消/暂停？
7. 历史任务数据和性能日志的保留周期？
