# 万能导入 V4 — 异步事件驱动批量下单系统

> V4 重构：将同步阻塞式导入升级为异步事件驱动架构，支撑 10,000 单/分钟吞吐。
> 基于 Next.js 15 (App Router) + TypeScript + Tailwind CSS v4 + Neon PostgreSQL

## V4 新增功能

- **异步导入**：上传即返回 task_id（< 1s），后台分批并发处理
- **Transactional Outbox**：任务创建与事件投递同事务，保证不丢失
- **批量处理**：1,000 行/批，批量 SKU 校验 + 批量 UPSERT 写入
- **全链路追踪**：traceId 贯穿 API → Outbox → Worker → DB
- **监控看板**：实时吞吐、队列积压、阶段耗时 P50/P95/P99、错误分布
- **容灾降级**：SKU 校验超时自动降级，前端明确提示
- **精细化错误**：行级错误记录，按批次/错误码筛选分页

## V4 新增页面

| 页面 | 路由 | 说明 |
|---|---|---|
| 导入任务列表 | `/import-tasks` | 查看所有异步任务及进度 |
| 任务详情 | `/import-tasks/[taskId]` | 任务进度、批次性能、错误详情 |
| 监控看板 | `/import-tasks/monitor` | 吞吐量、队列积压、阶段耗时、错误分布 |
| Trace 检索 | `/import-tasks/trace/[traceId]` | 全链路时间线 |
| Trace 搜索 | `/import-tasks/search` | 多条件检索

---

## V4 自测方案（完整流程）

按以下步骤可自测验证 V4 异步导入系统全部功能：

### 前置条件

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（.env 文件）
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
AI_API_KEY=sk-xxx        # AI 大模型 API Key（可选，无 Key 时使用启发式解析）
AI_API_URL=https://api.deepseek.com/v1/chat/completions
AI_MODEL=deepseek-chat
```

### 第一步：启动服务

```bash
npm run dev
# 浏览器打开 http://localhost:3000
```

### 第二步：初始化数据库

```bash
# 方式一（推荐，幂等安全，自动建 V2+V4 全部表）：
curl -X POST http://localhost:3000/api/init

# 方式二（仅建 V2 表）：
node scripts/init-db.mjs
```

### 第三步：准备压测数据

```bash
# 生成 20,000 条 SKU 主数据 + 10,000 行 Excel 压测文件
node scripts/seed-data.mjs

# 检查输出：
#   - test-data/10000-orders.xlsx（10,000 行运单数据，含 5 个非法 SKU）
#   - 数据库 sku_master 表应有 20,000 条记录
```

### 第四步：创建解析规则

1. 浏览器打开 `http://localhost:3000`
2. 上传 `test-data/10000-orders.xlsx`
3. 点击「AI 分析生成规则」（如有 AI Key）或手动配置规则
4. 规则配置要点：
   - 外部编码 → `外部编码` 列
   - SKU编码 → `SKU编码` 列
   - SKU名称 → `SKU名称` 列
   - SKU数量 → `SKU数量` 列
   - 收货门店 → `收货门店` 列
   - 收件人 → `收件人` 列
   - 收件人电话 → `收件人电话` 列
   - 收件人地址 → `收件人地址` 列
5. 保存规则，**记下规则 ID**（如 `rule_xxx`）

### 第五步：V4 异步导入测试

**方式 A：通过 API 测试**

```bash
# 上传文件创建异步任务（< 1 秒返回 task_id）
RULE_ID=rule_xxx  # 替换为第四步获得的规则 ID

curl -X POST http://localhost:3000/api/import-tasks \
  -F "file=@test-data/10000-orders.xlsx" \
  -F "ruleId=$RULE_ID"

# 返回示例：
# {"task_id":"task_abc123","trace_id":"trace_xyz789","status":"PENDING","total_rows":10000,"total_batches":10}

# 记录返回的 task_id，然后触发调度器：
TASK_ID=task_abc123

# 触发 Dispatcher（首次处理）
curl -X POST http://localhost:3000/api/import-tasks/dispatch

# 查询任务进度
curl http://localhost:3000/api/import-tasks/$TASK_ID

# 查询错误详情
curl http://localhost:3000/api/import-tasks/$TASK_ID/errors

# 查询批次性能
curl http://localhost:3000/api/import-tasks/$TASK_ID/batches

# 查询 Trace 时间线
curl http://localhost:3000/api/traces/trace_xyz789
```

**方式 B：通过页面测试**

1. 浏览器打开 `http://localhost:3000/import-tasks`
2. 点击「监控看板」查看实时吞吐量、队列积压、阶段耗时、错误分布
3. 返回任务列表，点击任务进入详情页
4. 每 2 秒自动触发 Dispatcher 并刷新进度
5. 查看批次处理详情表格和错误明细
6. 点击「查看全链路 Trace」跳转到时间线页面

### 第六步：运行压测脚本

```bash
# 确保第四步已创建规则，然后运行压测：
BENCHMARK_RULE_ID=rule_xxx node scripts/benchmark.mjs

# 脚本会：
# 1. 上传 10,000 行 Excel 文件
# 2. 记录上传接口响应时间
# 3. 自动轮询触发 Dispatcher 直到任务完成
# 4. 统计全链路总耗时
# 5. 输出是否达标（≤ 60 秒）
# 6. 生成 test-data/benchmark-report.json
```

### 第七步：运行单元测试

```bash
npm test

# 预期输出：
# Tests: 60 passed, 60 total
# 覆盖：上传接口、Outbox 事务、Dispatcher 可靠性、Worker 幂等、
#       SKU 批量校验、部分失败处理、降级模式、脱敏逻辑、
#       错误码映射、Trace 时间线、权限保护、任务状态聚合
```

### 第八步：验证监控看板

1. 打开 `http://localhost:3000/import-tasks/monitor`
2. 确认 4 个区域正常展示：
   - 实时吞吐量（柱状图）
   - 队列积压（待处理批次/行数 + 橙色预警）
   - 阶段耗时分布（P50/P95/P99 表格）
   - 错误类型分布（条形图）
3. 打开 `http://localhost:3000/import-tasks/search` 搜索 Trace

### 第九步：验证容灾降级

1. 在 `.env` 中临时修改 `DATABASE_URL` 为无效连接
2. 重新创建导入任务
3. 任务详情页应显示「⚠️ SKU 校验已降级」
4. Trace 时间线应包含 `SKUValidationDegraded` 事件
5. 恢复 `DATABASE_URL` 后，新任务应自动恢复正常

### 验收清单

| 验收项 | 检查方式 | 通过标准 |
|---|---|---|
| 上传接口 ≤ 1 秒 | 压测脚本 / curl 计时 | P95 < 1000ms |
| 10,000 行 ≤ 60 秒 | `node scripts/benchmark.mjs` | total_duration ≤ 60s |
| SKU 主数据 20,000 条 | `SELECT COUNT(*) FROM sku_master` | ≥ 20000 |
| 压测文件 10,000 行 | 打开 `test-data/10000-orders.xlsx` | 数据行 ≥ 10000 |
| 批量 SKU 校验 | 查看 Worker 日志 | 使用 `WHERE sku_code = ANY($1)` |
| 批量写入 | 查看 Worker 日志 | 使用 UNNEST 批量 INSERT |
| 错误可定位 | 任务详情页 → 错误详情 | 显示行号、字段、错误码、脱敏值 |
| 幂等处理 | 重复触发 dispatch | 不会重复写入/重复累计进度 |
| 降级模式 | 断开 DB 后创建任务 | 前端显示降级提示 |
| Trace 追踪 | `/import-tasks/trace/[traceId]` | 显示完整时间线 |
| 监控看板 | `/import-tasks/monitor` | 4 个区域均正常 |
| 单元测试 | `npm test` | 60 passed |
| 无密钥泄漏 | `grep -r "sk-" src/` | 无结果 |

---

## 一、目录

1. [项目简介](#二项目简介)
2. [快速开始](#三快速开始)
3. [使用的大模型](#四使用的大模型)
4. [Prompt 设计思路](#五prompt-设计思路)
5. [API Key 与环境变量配置](#六api-key-与环境变量配置)
6. [整体架构](#七整体架构)
7. [规则引擎设计](#八规则引擎设计)
8. [支持的出库单格式与解析方式](#九支持的出库单格式与解析方式)
9. [常见问题](#十常见问题)

---

## 二、项目简介

物流/快递行业需要频繁批量下单，客户提供的文件格式各异（Excel / Word / PDF），文档结构复杂（干扰性头部、横向排列字段、合并单元格、非标准表格等）。

**本系统**：

- 上传任意格式的出库单文件（.xlsx / .xls / .docx / .pdf）
- 选择或新建一条「解析规则」描述文件结构
- 执行解析 → 预览/编辑 → 校验 → 提交下单 → 入库

**核心架构理念**：不写 if-else 适配每种文件，而是设计一套**通用规则描述语言 + 规则引擎**。每种新格式只需「配置一条规则」即可适配，**新增第 N 种格式时代码零改动**。

---

## 三、快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（参考 .env.example）
cp .env.example .env
# 编辑 .env 填入 AI_API_KEY 和 DATABASE_URL

# 3. 初始化数据库（首次运行时执行，自动建 V2+V4 全部表）
#    方式一：调用建表接口（推荐，等幂安全）
curl -X POST http://localhost:3000/api/init
#    方式二：脚本（仅建 V2 的 orders 表，兼容旧逻辑）
node scripts/init-db.mjs

# 4. 启动开发服务器
npm run dev

# 5. 浏览器打开
open http://localhost:3000
```

部署到 Vercel 时，把 `.env` 中的变量填到 Vercel 项目设置的 Environment Variables 中即可。

---

## 四、使用的大模型

| 项 | 值 |
| --- | --- |
| **模型** | `deepseek-chat`（DeepSeek-V3） |
| **API 协议** | OpenAI 兼容（`/v1/chat/completions`） |
| **默认 Base URL** | `https://api.deepseek.com/v1/chat/completions` |
| **可替换为** | 任何 OpenAI 兼容的 Chat Completion 服务（OpenAI、Moonshot、智谱、月之暗面、硅基流动等） |

**为什么选 DeepSeek**：

- 中文出库单场景对中文长文本结构化输出的准确率高
- 价格低（输入 1 元/百万 token 量级），对长 PDF/Excel 的全文 prompt 友好
- 支持 `response_format: { type: "json_object" }`，保证结构化输出
- OpenAI 兼容协议，可一行配置替换为 GPT-4o、Claude 等其他模型

**模型可替换性**：通过 `AI_API_KEY` / `AI_API_URL` / `AI_MODEL` 三个环境变量即可切换到任意 OpenAI 兼容服务，无需改代码。

**回退机制**：当未配置 API Key 或 AI 调用失败时，系统自动降级为**本地启发式解析**（`heuristicAnalysis`），基于关键词字典+表头行识别+列名匹配，仍能解析大部分标准格式出库单。

---

## 五、Prompt 设计思路

### 5.1 设计目标

让 LLM 一次调用，输出**可直接落库的解析规则 JSON**，且能覆盖 9 份 demo 的所有差异布局（标准表 / 多区域 / 卡片式 / 矩阵式 / 纯文本 / 多 Sheet 等）。

**约束**：

- 规则必须**可复用、可编辑、可持久化**——AI 给的是"建议"，不是"成品"
- 所有列名/行键必须**从文件真实内容中识别**，禁止照抄示例
- 输出必须**纯 JSON**（不包裹 markdown 代码块），方便解析

### 5.2 Prompt 结构（`src/lib/ai-service.ts: buildAnalyzePrompt`）

```
┌─────────────────────────────────────────────────────────┐
│ System: "出库单解析专家。直接输出 JSON，无 markdown"   │
├─────────────────────────────────────────────────────────┤
│ User:                                                   │
│  1. 角色定位: 你是出库单解析专家                       │
│  2. 任务: 分析 XLSX 文件, 输出 JSON 解析规则          │
│  3. 文件元信息: 文件名 + 类型 + 文件布局提示           │
│  4. 文件内容预览: 前 4000 字符（"行1: ... | ..."）    │
│  5. 关键指令: 列名必须从文件实际内容识别, 不要照抄示例│
│  6. 规则:                                            │
│     - 字段映射规则 (column_name / row_field / 矩阵转置)│
│     - 模式标志 (cardMode / matrixMode)              │
│     - 外部编码选择规则 (拒选"配送汇总单号"等)        │
│  7. 输出 JSON 结构 schema: 完整的 FieldMapping 数组  │
└─────────────────────────────────────────────────────────┘
```

### 5.3 关键设计点

#### ① 角色 + 任务 + Schema 三段式

LLM 在"专家角色 + 明确任务 + 严格 schema"三重约束下，结构化输出的稳定性最高。

#### ② 文件布局提示（按文件类型分支）

Prompt 中会根据 `fileType` 注入**对应布局的可能模式**：

- **Excel**：标准表 / 多区域 / 卡片式 / **矩阵式**（库存分配表）
- **Word**：纯文本段落
- **PDF**：多页、key:value 对

让 LLM 知道"应该从哪几种布局里挑"，避免它在不存在的布局上发散。

#### ③ 关键指令反例

```
**所有字段映射（columnName、rowKeyPattern）必须从文件实际内容中识别，不要照抄下面示例！**
```

LLM 有强烈的"抄示例"倾向，这一行指令是反抄锚点。

#### ④ 字段映射的 4 种 mode

让 LLM 按"该字段在文件里实际怎么出现"选 mode，而不是只会"列名匹配"：

| mode | 含义 | 适用 |
| --- | --- | --- |
| `column_name` | 表头行有该列，按列名取 | 标准表、卡片内小表 |
| `row_field` | 表头没这列，但内容里有"key：value"行 | 头/尾元数据行（"调拨单号：xxx"） |
| `matrix_transpose` | 矩阵转置（由引擎自动处理） | 矩阵式库存分配表 |
| 卡片模式不写映射 | 卡片头信息由 cardMode 自动提取 | 卡片式 Excel |

#### ⑤ 外部编码反陷阱

```text
5. 外部编码（externalCode）选列规则：
   - 优先选"配送单号/单据号/订单号"（单据级唯一）
   - 不要选"配送汇总单号"（父级汇总单号，多 SKU 共享）
   - 如果两类都有，强制选不带"汇总"的"配送单号"
```

这一条是反复踩坑后沉淀的：很多出库单里"配送汇总单号"和"配送单号"并存，AI 经常选错导致多 SKU 共享同一外部编码 → 落库时被当成重复单据。

#### ⑥ 兜底关键词字典（`heuristicAnalysis`）

AI 失败/无 Key 时走启发式。字典里每个字段都按"精确关键词 → 宽泛兜底关键词"的顺序排列，priority 越小优先级越高：

```ts
skuCode: ["SKU条码", "外部商品编码", "物品编码", "产品编码", "商品编码", "货号", "条码", "SKU", "编码"]
storeName: ["调入门店", "收货门店", "调入方", "收货机构", "客户名称", "收货单位", "店铺", "门店"]
externalCode: ["配送单号", "配送发货单", "发货单", "调拨单号", "单据编号", "单据号", "订单号", "外部编码", "运单号", "单号", "配送汇总单号"]
```

`getDataCells` + `isCellMatchKeyword` 走"完整 cell 匹配 / cell 起始匹配"，避免"发货单价"误匹配"发货单"等子串误判。

#### ⑦ AI 输出后处理

LLM 的 JSON 输出经常"看起来是 JSON 但 parse 失败"——可能多了一层 markdown、可能多了一句解释。系统做了 4 策略容错：

```
1. 直接 JSON.parse
2. 去掉 ```json ... ``` 包裹
3. 截取第一个 { 到最后一个 }
4. fixCommonJSON: 补闭合引号 + 移除尾逗号
```

全部失败 → 降级到 `heuristicAnalysis`。

#### ⑧ 调用参数优化

- `temperature: 0.1` — 让输出稳定可复现
- `max_tokens: 1200` — 规则 JSON 不需要长篇大论，限制 token 让响应更快
- `response_format: { type: "json_object" }` — 强制 JSON 输出
- `AbortController(60s)` — 超时保护
- `fileContent.substring(0, 4000)` — 限制 prompt 长度，避免超大文件把 token 撑爆

### 5.4 AI 生成后的人工修正入口

AI 给的规则不是直接生效，而是**落到前端规则编辑器**（`RuleEditor`），让用户：

- 看到每个字段的"AI 选了哪一列 + 置信度"
- 直接修改列名（input 是普通文本输入框，不是下拉）
- 保存时才入库

**这是核心信任设计**：用户对 AI 结果有 100% 修正权，不让 AI 黑盒决定业务字段映射。

### 5.5 AI 列名兜底修正（防 AI 幻觉）

LLM 偶尔会把"出库日期/配送汇总单号"误选为 externalCode/storeName，规则编辑前系统会自动清空并标注原因（`ai-service.ts: clearInvalidColumn`）：

1. 选了"汇总"相关的列名 → 启发式找更好的候选
2. 列名含"日期/时间"等关键词 → 清空
3. 列名出现在元数据行的 key 位置（"出库日期：xxx"）→ 清空
4. 数据行该列的值是 YYYY-MM-DD 日期 → 清空
5. 列名在真实表头行中找不到（AI 幻觉）→ 清空

清空后给用户保留"AI 原选了 X（原因）"的提示，让用户决定填什么。

---

## 六、API Key 与环境变量配置

### 6.1 环境变量清单（`.env.example`）

```bash
# ===== AI 大模型配置 =====
# 支持 OpenAI、DeepSeek、Moonshot、智谱、Claude 等任何 OpenAI 兼容 API
AI_API_KEY=your_api_key_here
AI_API_URL=https://api.deepseek.com/v1/chat/completions
AI_MODEL=deepseek-chat

# ===== 数据库配置（Neon / Supabase / 本地 Postgres） =====
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

### 6.2 本地开发配置

```bash
# 1. 复制模板
cp .env.example .env

# 2. 填入 AI_API_KEY
#    - DeepSeek: https://platform.deepseek.com → API Keys → 创建
#    - OpenAI:   https://platform.openai.com/api-keys
#    - Moonshot: https://platform.moonshot.cn
#    - 智谱:     https://open.bigmodel.cn
AI_API_KEY=sk-xxxxxxxxxxxx
AI_API_URL=https://api.deepseek.com/v1/chat/completions
AI_MODEL=deepseek-chat

# 3. 填入 DATABASE_URL
#    - Neon:    https://console.neon.tech → 创建项目 → 复制 connection string
#    - Supabase: https://supabase.com → 项目 Settings → Database → Connection string
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### 6.3 Vercel 部署配置

1. 把代码推送到 GitHub
2. 在 [Vercel Dashboard](https://vercel.com/dashboard) → Import Project → 选择仓库
3. 进入项目 **Settings → Environment Variables**，添加：

| Key | Value | Environment |
| --- | --- | --- |
| `AI_API_KEY` | `sk-xxxxxxxx` | Production / Preview / Development |
| `AI_API_URL` | `https://api.deepseek.com/v1/chat/completions` | 同上 |
| `AI_MODEL` | `deepseek-chat` | 同上 |
| `DATABASE_URL` | `postgresql://...?sslmode=require` | 同上 |

4. Deploy 即可

### 6.4 切换不同模型

只需改三个环境变量，**代码完全不用动**：

```bash
# OpenAI GPT-4o
AI_API_KEY=sk-...
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_MODEL=gpt-4o

# Claude（通过 OpenRouter 代理）
AI_API_KEY=sk-or-...
AI_API_URL=https://openrouter.ai/api/v1/chat/completions
AI_MODEL=anthropic/claude-3.5-sonnet

# 智谱 GLM-4
AI_API_KEY=...
AI_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
AI_MODEL=glm-4-plus

# 硅基流动（国内代理多个开源模型）
AI_API_KEY=...
AI_API_URL=https://api.siliconflow.cn/v1/chat/completions
AI_MODEL=Qwen/Qwen2.5-72B-Instruct
```

### 6.5 安全性说明

- **API Key 不入仓库**：`.env` 在 `.gitignore` 中，只提交 `.env.example`（只含字段名不含值）
- **不暴露给前端**：AI 调用走 Next.js API Route (`/api/ai-generate-rules`)，Key 仅在服务端使用
- **Vercel 环境变量加密**：Vercel 存储的 env var 默认加密
- **请求超时保护**：60s `AbortController`，防止 AI 拖死请求
- **降级策略**：AI 失败/超时时自动降级到本地启发式解析（无 AI 也能用）

---

## 七、整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                       Next.js 15 App Router                 │
│                                                              │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐         │
│  │  page.tsx│   │  history/    │   │  rules/      │         │
│  │ 导入下单 │   │ 运单列表    │   │ 规则管理    │         │
│  └────┬─────┘   └──────┬───────┘   └──────┬───────┘         │
│       │                │                  │                  │
│  ┌────▼────────────────▼──────────────────▼──────────────┐   │
│  │           Components: 卡片 / 表格 / 编辑器           │   │
│  └────┬─────────────────────────────────────────────────┘   │
│       │                                                       │
│  ┌────▼─────────────────────────────────────────────────┐   │
│  │   API Routes: /api/rules, /api/parse (SSE),         │   │
│  │              /api/orders, /api/ai-generate-rules   │   │
│  └────┬─────────────────────────────────────────────────┘   │
│       │                                                       │
│  ┌────▼─────────────────────────────────────────────────┐   │
│  │                  lib/ 核心库                         │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐    │   │
│  │  │ai-service  │  │rule-engine │  │file-parser │    │   │
│  │  │AI 分析    │  │ 规则执行  │  │ Excel/Word │    │   │
│  │  │            │  │            │  │   /PDF    │    │   │
│  │  └────────────┘  └────────────┘  └────────────┘    │   │
│  │  ┌────────────┐  ┌────────────┐                     │   │
│  │  │validation  │  │  db.ts     │                     │   │
│  │  │ 数据校验  │  │ 数据库    │                     │   │
│  │  └────────────┘  └────────────┘                     │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                       │
└───────┼───────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────┐  ┌────────────────────┐
│  DeepSeek / GPT    │  │  Neon / Supabase   │
│  (大模型 API)      │  │  (PostgreSQL)      │
└────────────────────┘  └────────────────────┘
```

### 关键流程

```
上传文件 → 选/建规则(可选 AI 预分析) → 执行解析(SSE 流式进度)
        → 数据预览 + 实时校验 → 提交下单(SSE 流式进度) → 入库
```

---

## 八、规则引擎设计

### 8.1 规则数据结构

```ts
interface ParseRule {
  id: string;
  name: string;                  // 规则名（用户可命名）
  fileType: "excel" | "word" | "pdf";
  headerRow: number;             // 表头行号（0-based）
  skipRows: number;              // 跳过行数
  fieldMappings: FieldMapping[]; // 字段映射
  globalConfig: {
    mode: "outbound" | "transfer";  // 出库 / 调拨
  };
  aiGenerated: boolean;
  // ...
}

interface FieldMapping {
  targetField: "skuCode" | "skuName" | "skuQuantity" | "skuSpec"
              | "storeName" | "externalCode"
              | "recipientName" | "recipientPhone" | "recipientAddress"
              | "remark";
  mode: "column_name" | "row_field" | "matrix_transpose";
  columnName?: string;            // 表头列名
  rowKeyPattern?: string;         // 行 key（如"调拨单号"）
  regexPattern?: string;
  staticValue?: string;
  defaultValue?: string;
  confidence: number;             // AI 置信度
}
```

### 8.2 规则引擎能覆盖的复杂场景

| 场景 | 实现方式 |
| --- | --- |
| 干扰头部 | `skipRows` 跳过 + `headerRow` 指向真实表头行 |
| 尾部信息提取 | 尾部 key:value 行扫描，`row_field` mode + `rowKeyPattern` |
| 跨行聚合 | 同一 externalCode 下的多行共享 storeName/recipient*（按需合并） |
| 矩阵转置 | `matrix_transpose` mode + `storeColumnNames` 列表 |
| 多对多映射 | 一个 targetField 可有多个候选（fallback） |
| 默认值 | `defaultValue` 兜底 |
| 静态值提取 | `staticValue` 给所有行赋同值 |
| 多 Sheet 合并 | `mergeSheets: true` + 遍历所有 sheet |
| 卡片式 | `cardMode: true` + `cardStartMarker`（如"▶ 调拨记录#N"） |
| 纯文本 | 自由 regex + 行 key 提取 |

### 8.3 代码零硬编码

- **不出现文件名判断**：解析逻辑只认 rule 结构，不认"湖南仓""欢乐牧场"等文件名
- **不出现特定列名硬编码**：所有列名都来自规则的 `columnName`/`rowKeyPattern`
- **不出现特定值硬编码**：所有数据值都从文件提取

---

## 九、支持的出库单格式与解析方式

| 格式 | 典型场景 | 解析方式 |
| --- | --- | --- |
| Excel 标准表 | 普通出库单 | `column_name` mode + `headerRow` |
| Excel 干扰头部 | 表前/表后有公司名、日期、合计 | `skipRows` + 尾部 key:value 提取 |
| Excel 跨行聚合 | 同配送单号多 SKU 共享收货信息 | 按 `externalCode` 自动合并收货信息 |
| Excel 矩阵转置 | 库存分配表（SKU × 门店） | `matrix_transpose` mode + 门店列名列表 |
| Excel 多 Sheet | 3 个门店 = 3 个 sheet | `mergeSheets: true` 遍历 sheet |
| Excel 卡片式 | "▶ 调拨记录#N" 分隔 | `cardMode: true` + 卡片边界识别 |
| Excel 复合单元格 | 一个 cell 内多行"物品名 x 数量" | 复合单元格拆分（按 `\n`） |
| Word 纯文本 | 无表格，物品信息嵌在段落 | 行 key 正则提取 |
| PDF 多页多单 | 一个 PDF 含 3 个独立签收单 | PDF 多订单拆分 + 每单收货信息配对 |
| PDF 头部元信息 | "客户：xxx  日期：xxx" | 元数据行 `row_field` 提取 |
| PDF 底部签字区 | 收货人/电话/地址在最后一行 | 尾部 key:value 提取 |

---

## 十、常见问题

### Q1: 没有 AI API Key 也能用吗？
**A**: 可以。系统会自动降级到本地启发式解析（基于关键词字典），能覆盖大部分标准 Excel 格式出库单。但对于卡片式、矩阵式、纯文本等复杂布局，仍建议配置 AI 以获得更高准确率。

### Q2: AI 生成的规则不满意怎么办？
**A**: 规则编辑页面（`RuleEditor`）是普通表单，每个字段的"对应列名"都是可编辑的 input 框，直接修改即可保存。AI 给的只是建议，**用户有 100% 修正权**。

### Q3: 如何提高 AI 解析准确率？
**A**:
- 优先用支持 `response_format: json_object` 的模型（DeepSeek/GPT-4o/GLM-4 等）
- `temperature` 保持低值（已默认 0.1）
- 如果文件 >4000 字符，只截前 4000 字符进 prompt，AI 可能漏看后段；可考虑分段分析或增加 max_tokens

### Q4: 数据库可以选哪些？
**A**: 任何 PostgreSQL 兼容的数据库：
- **Neon**（推荐，免费档够用，serverless 友好）
- **Supabase**
- **Turso**（SQLite 兼容）
- **本地 Postgres**（开发用）

### Q5: 部署到 Vercel 注意事项？
**A**:
- `pdfjs-dist` 4.x 需要配置 `serverExternalPackages`（已在 `next.config.ts` 配置好）
- `DATABASE_URL` 必须支持 SSL（`?sslmode=require`）
- AI API URL 在 Vercel 区域可能需要能访问外网（默认可以）

### Q6: 性能如何？
**A**:
- 1000 条 Excel 数据，从上传到预览 < 10 秒（不含 AI 解析时间）
- 前端 1000 条数据渲染 < 3 秒
- 1000+ 条数据用虚拟列表（`@tanstack/react-virtual`）保证流畅

---

## 附录：项目目录结构

```
universal-import-v2/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── page.tsx              # 导入下单首页
│   │   ├── history/              # 已导入运单列表
│   │   ├── rules/                # 规则管理
│   │   ├── orders/               # 运单详情
│   │   └── api/                  # API Routes
│   │       ├── rules/            # 规则 CRUD
│   │       ├── parse/            # 解析 (SSE)
│   │       ├── orders/           # 订单 CRUD
│   │       └── ai-generate-rules/ # AI 分析
│   ├── components/               # UI 组件
│   │   ├── upload/               # 上传 + 规则选择
│   │   ├── preview/              # 数据预览 + 规则编辑
│   │   └── ui/                   # 通用组件
│   ├── lib/                      # 核心库
│   │   ├── ai-service.ts         # AI 大模型调用 ⭐
│   │   ├── rule-engine.ts        # 规则引擎 ⭐
│   │   ├── file-parser.ts        # Excel/Word/PDF 解析
│   │   ├── validation.ts         # 数据校验
│   │   ├── db.ts                 # 数据库连接
│   │   └── utils.ts              # 工具函数
│   └── types/                    # TypeScript 类型
├── public/                       # 静态资源
├── scripts/                      # 脚本
│   └── init-db.mjs               # 数据库初始化
├── .env.example                  # 环境变量模板
├── next.config.ts                # Next.js 配置
└── package.json
```

---
## V3 运单全流程管理系统

> V3 是本项目的扩展模块，覆盖运单从入仓到交付的完整生命周期，包括扫描品控、异常上报、分级审批、执行联动等功能。

### 快速开始

1. 访问 `/v3/tickets` 进入工单管理
2. 点击「生成模拟数据」创建 200 条测试工单
3. 各模块入口：扫描品控 → 工单管理 → 异常上报 → 审批中心 → 规则配置 → 同步监控

### V3 架构

- **独立数据库表**：V3 使用独立的数据库表，不直接访问 V2 业务表
- **通过接口对接 V2**：运单数据通过 HTTP API 从 V2 获取（`/api/v2/external/*`）
- **两套状态机**：工单状态机 + 扫描批次状态机，通过 ticket_id 关联
- **可配置规则引擎**：品控规则 + 审批阈值均可通过后台配置，无需修改代码

### V3 文档

- `ASSUMPTIONS.md` - 需求理解与假设说明（9 项留白规则补全）
- `API_CONTRACT.md` - V3→V2 系统间接口文档

---

**License**: MIT
