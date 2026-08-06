# 交付物详细列表

> 对应需求文档「十三、提交物清单（强制）」

---

## 1. 在线地址

| 项目 | 地址 |
|---|---|
| 生产环境 | [https://import-v2.vercel.app](https://import-v2.vercel.app) |
| 首页（上传入口） | `/` |
| 导入任务列表 | `/import-tasks` |
| 任务详情 | `/import-tasks/[taskId]` |
| 监控看板 | `/import-tasks/monitor` |
| Trace 时间线 | `/import-tasks/trace/[traceId]` |
| Trace 搜索 | `/import-tasks/search` |
| 已导入运单 | `/history` |
| 解析规则管理 | `/rules` |

---

## 2. 源码仓库

| 项目 | 地址 |
|---|---|
| GitHub | [https://github.com/yaro-yang/import-v2](https://github.com/yaro-yang/import-v2) |
| 分支 | `main` |

---

## 3. 压测数据脚本

| 文件 | 说明 |
|---|---|
| `scripts/seed-data.mjs` | 一键生成 20,000 条 SKU 主数据 + 10,000 行 Excel 压测文件 |
| `scripts/benchmark.mjs` | 压测脚本：上传 → 轮询进度 → 统计耗时 → 输出报告 |
| `scripts/init-db.mjs` | 数据库初始化脚本（建表 + 索引） |

执行方式：

```bash
# 生成压测数据
node scripts/seed-data.mjs

# 运行压测
node scripts/benchmark.mjs
```

seed-data 脚本特性：
- 幂等可重复执行（先清理再灌入，不产生脏数据累积）；
- SKU 编码格式 `SKU_00001` ~ `SKU_20000`；
- 压测文件中故意插入 5 个非法 SKU（`INVALID_SKU_001` 等），用于验证错误定位能力。

---

## 4. 10,000 行压测 Excel 文件

| 文件 | 大小 | 说明 |
|---|---|---|
| `test-data/10000-orders.xlsx` | 9.1 MB | 10,000 行运单数据，含合法和非法 SKU |
| `public/10000-orders.xlsx` | 9.1 MB | 线上可访问副本（用于 from-url 导入） |

---

## 5. 压测报告

| 文件 | 说明 |
|---|---|
| `docs/BENCHMARK_REPORT.md` | 完整压测报告：吞吐量、阶段耗时、错误率、数据库连接、监控截图 |

报告包含：
- 测试时间、部署环境、Worker 配置；
- 上传接口 P95；
- 任务总耗时；
- 各处理单元 P50/P95/P99；
- SKU 校验耗时、数据库写入耗时；
- 错误率、错误分布；
- 监控看板数据；
- 结论和已知瓶颈。

---

## 6. 架构设计文档

| 文件 | 说明 |
|---|---|
| `docs/ASSUMPTIONS_V4.md` | 架构设计文档（《重构假设说明》）：异步事件驱动流程图、Outbox 模式、批量处理策略、容量推导 |
| `docs/API_V4.md` | 接口文档：上传、任务查询、错误查询、Trace 查询、监控聚合 |

---

## 7. 《重构假设说明》

| 文件 | 说明 |
|---|---|
| `docs/ASSUMPTIONS_V4.md` | 覆盖需求文档「模块十一」全部 12 项要求 |

包含内容：
1. 为什么选择异步事件驱动，而不是继续同步处理；
2. 处理单元大小如何设计（1000 行/批），为什么这样设计；
3. Worker / Consumer 的容量规划；
4. 10,000 单/分钟的性能推导；
5. 数据库连接池和 Worker 并发如何控制；
6. Outbox 如何避免"任务创建成功但消息丢失"；
7. 处理单元 Job 如何做到幂等；
8. 部分行失败时为什么允许成功行继续入库；
9. SKU 校验降级的触发条件和风险提示；
10. 错误日志中敏感数据如何脱敏；
11. 压测数据如何生成、如何清理；
12. 如果可以向产品经理或运维团队提问，会问哪些问题。

---

## 8. 接口文档

| 文件 | 说明 |
|---|---|
| `docs/API_V4.md` | V4 异步导入系统全部 API 接口文档 |
| `API_CONTRACT.md` | V3 ↔ V2 系统间接口契约 |

API 列表：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/import-tasks` | 上传文件创建异步任务 |
| POST | `/api/import-tasks/from-url` | 从公开 URL 创建任务（大文件模式） |
| GET | `/api/import-tasks/:taskId` | 查询任务进度 |
| GET | `/api/import-tasks/:taskId/errors` | 查询错误明细（支持分页/筛选） |
| GET | `/api/import-tasks/:taskId/batches` | 查询批次性能 |
| POST | `/api/import-tasks/dispatch` | 手动触发 Outbox 分发 |
| POST | `/api/import-tasks/reset` | 重置卡住的任务 |
| GET | `/api/import-tasks/search` | 按文件名搜索任务 |
| GET | `/api/traces/:traceId` | 全链路 Trace 时间线 |
| GET | `/api/import-monitor/summary` | 监控聚合指标 |
| GET | `/api/rules` | 解析规则列表 |
| POST | `/api/ai-generate-rules` | AI 生成解析规则 |

---

## 9. README

| 文件 | 说明 |
|---|---|
| `README.md` | 本地启动、环境变量、部署、压测、故障模拟说明 |

---

## 10. 演示账号或访问说明

系统无需登录，所有页面可直接访问：

- 打开 [https://import-v2.vercel.app](https://import-v2.vercel.app) 进入首页；
- 上传 Excel/Word/PDF 文件 → 选择解析规则 → 创建导入任务；
- 查看任务进度：`/import-tasks` 列表或 `/import-tasks/[taskId]` 详情；
- 查看监控：`/import-tasks/monitor`；
- 查看历史运单：`/history`。

---

## 11. 其他补充文件

| 文件 | 说明 |
|---|---|
| `docs/REFLECTION.md` | 反思题回答（需求文档第十四章，不计分） |
| `docs/AI_USAGE.md` | 大模型调用说明（DeepSeek API 配置与使用） |
| `docs/DELIVERABLES.md` | 本文档：交付物详细列表 |

---

## 提交物完整性对照

| # | 需求要求 | 对应文件 | 状态 |
|---|---|---|---|
| 1 | 在线地址 | `https://import-v2.vercel.app` | ✅ |
| 2 | 源码仓库 | `github.com/yaro-yang/import-v2` | ✅ |
| 3 | 压测数据脚本 | `scripts/seed-data.mjs` | ✅ |
| 4 | 10,000 行压测文件 | `test-data/10000-orders.xlsx` | ✅ |
| 5 | 压测报告 | `docs/BENCHMARK_REPORT.md` | ✅ |
| 6 | 架构设计文档 | `docs/ASSUMPTIONS_V4.md` | ✅ |
| 7 | 《重构假设说明》 | `docs/ASSUMPTIONS_V4.md` | ✅ |
| 8 | 接口文档 | `docs/API_V4.md` + `API_CONTRACT.md` | ✅ |
| 9 | README | `README.md` | ✅ |
| 10 | 演示说明 | 本文档第 10 节 | ✅ |
