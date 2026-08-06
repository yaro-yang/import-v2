# 大模型调用说明

> 本文档说明 V2 万能导入系统中 AI 大模型的调用方式、配置与使用场景。

---

## 一、使用的模型

| 项目 | 值 |
|---|---|
| 模型提供商 | DeepSeek |
| API 地址 | `https://api.deepseek.com/v1/chat/completions` |
| 模型名称 | `deepseek-chat` |
| 调用方式 | HTTP POST（OpenAI 兼容格式） |

---

## 二、环境变量配置

在 `.env` 文件或 Vercel Environment Variables 中配置：

```bash
AI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # DeepSeek API Key（必填）
AI_API_URL=https://api.deepseek.com/v1/chat/completions  # API 地址（可选，默认值如上）
AI_MODEL=deepseek-chat                            # 模型名称（可选，默认值如上）
```

**注意**：
- `AI_API_KEY` 是必填项，未配置时 AI 功能不可用，系统将回退到启发式解析；
- `AI_API_URL` 和 `AI_MODEL` 有默认值，不配置亦可正常使用；
- 严禁将 API Key 提交到代码仓库（已在 `.gitignore` 中排除 `.env` 文件）。

---

## 三、AI 调用场景

### 3.1 场景一：AI 辅助生成解析规则

**触发路径**：用户上传文件 → 点击「AI 分析生成规则」按钮

**调用代码**：`src/lib/ai-service.ts` → `analyzeFileWithAI()`

**调用流程**：
1. 前端将文件表头数据（前 20 行预览 + 列名列表）发送到 `/api/ai-generate-rules`；
2. 后端调用 `analyzeFileWithAI()` 构造 Prompt，发送到 DeepSeek API；
3. AI 分析列名语义，自动推断字段映射（如"配送单号"→`externalCode`、"物品编码*"→`skuCode`）；
4. 返回 JSON 格式的解析规则，前端展示供用户确认/修改后保存。

**Prompt 示例**（简化）：

```text
你是一个专业的 Excel 解析规则生成助手。请分析以下文件结构，生成解析规则：

表头列名：
- A: 收货机构
- B: 配送单号
- C: 物品编码*
- D: 物品名称*
- E: 发货数量*

请为每个列推断对应的目标字段，返回 JSON 格式...
```

**AI 不是导入主链路的必要条件**：用户可手动配置解析规则，无需 AI。

### 3.2 场景二：V3 异常工单类型建议（加分项）

**触发路径**：V3 审批页面自动触发

**调用代码**：`src/app/api/v3/ai/suggest-type/route.ts`

**调用流程**：
1. 后端收集异常工单的字段值（运单号、异常描述、金额等）；
2. 发送到 DeepSeek API，请求建议工单类型（品控暂扣/赔付审批/缺货退款等）；
3. 返回建议类型及置信度，前端展示为可选项。

**降级策略**：AI API Key 未配置时返回 `null`，前端使用默认类型列表。

---

## 四、调用代码位置

| 文件 | 函数/路由 | 用途 |
|---|---|---|
| `src/lib/ai-service.ts` | `analyzeFileWithAI()` | 核心：调用 DeepSeek 分析文件结构生成解析规则 |
| `src/app/api/ai-generate-rules/route.ts` | `POST /api/ai-generate-rules` | 对外接口：接收文件数据，调用 `analyzeFileWithAI()` |
| `src/app/api/v3/ai/suggest-type/route.ts` | `POST /api/v3/ai/suggest-type` | V3 功能：AI 建议工单类型 |

---

## 五、错误处理与降级

| 情况 | 处理方式 |
|---|---|
| `AI_API_KEY` 未配置 | `analyzeFileWithAI()` 抛出明确错误："未配置 AI_API_KEY 环境变量"；前端提示用户手动配置规则 |
| API 调用超时（> 30s） | `AbortController` 取消请求，返回超时错误 |
| API 返回非 200 | 记录错误日志，返回友好提示："AI 分析失败，请稍后重试或手动配置规则" |
| AI 返回非 JSON | 增加重试（Prompt 中强调"只返回 JSON"），仍失败则返回解析错误 |
| AI 返回的字段映射不完整 | 前端展示 AI 推断结果，缺失字段留空供用户手动补充 |

**核心原则**：AI 是辅助工具，导入主链路不依赖 AI。AI 不可用时用户仍可手动配置规则完成导入。

---

## 六、费用说明

| 模型 | 输入价格 | 输出价格 | 单次调用预估 |
|---|---|---|---|
| deepseek-chat | ¥1 / 百万 token | ¥2 / 百万 token | < ¥0.01 |

单次分析请求约消耗 500-2000 token，成本极低。

---

## 七、切换其他模型

如需切换到其他 OpenAI 兼容模型（如 OpenAI GPT-4、通义千问等），只需修改环境变量：

```bash
# 切换到 OpenAI GPT-4o
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_MODEL=gpt-4o
AI_API_KEY=sk-xxxxxxxx

# 切换到通义千问（阿里云）
AI_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
AI_MODEL=qwen-plus
AI_API_KEY=sk-xxxxxxxx
```

代码无需修改，`ai-service.ts` 使用标准 OpenAI Chat Completions 格式。
