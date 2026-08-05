# V4 异步导入系统 API 接口文档

## 概述

V4 重构将同步阻塞式导入升级为异步事件驱动架构。上传文件后立即返回 `task_id`（< 1s），后台分批并发处理。

---

## 1. 上传接口

**POST** `/api/import-tasks`

### 请求

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | ✅ | Excel/Word/PDF 文件 |
| ruleId | string | ✅ | 解析规则 ID |

Content-Type: `multipart/form-data`

### 响应

```json
{
  "task_id": "task_abc123def456",
  "trace_id": "trace_789ghi012jkl",
  "status": "PENDING",
  "total_rows": 10000,
  "total_batches": 10
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 创建成功 |
| 400 | 参数缺失 |
| 404 | 规则不存在 |
| 500 | 服务器错误 |

### 性能要求

- P95 响应时间 ≤ 1 秒
- 任务创建 + 批次创建 + Outbox 写入在同一数据库事务中完成

---

## 2. 任务查询接口

**GET** `/api/import-tasks/:taskId`

### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| taskId | string | 任务 ID |

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| include | string | - | `batches` 时返回批次详情 |

### 响应

```json
{
  "task_id": "task_abc123def456",
  "file_name": "10000-orders.xlsx",
  "status": "PROCESSING",
  "total_rows": 10000,
  "processed_rows": 5000,
  "success_rows": 4990,
  "failed_rows": 10,
  "total_batches": 10,
  "completed_batches": 5,
  "degraded": false,
  "trace_id": "trace_789ghi012jkl",
  "created_at": "2026-08-05T10:00:00Z",
  "completed_at": null,
  "batches": [
    {
      "batch_index": 0,
      "start_row": 1,
      "end_row": 1000,
      "status": "COMPLETED",
      "retry_count": 0,
      "performance": {
        "parse_duration_ms": 450,
        "rule_duration_ms": 1800,
        "validate_duration_ms": 950,
        "insert_duration_ms": 2100,
        "total_duration_ms": 5300
      }
    }
  ]
}
```

### 任务状态说明

| 状态 | 说明 |
|------|------|
| PENDING | 等待处理 |
| PROCESSING | 处理中 |
| COMPLETED | 全部成功 |
| PARTIAL_SUCCESS | 部分成功（有失败行） |
| FAILED | 全部失败 |

---

## 3. 错误查询接口

**GET** `/api/import-tasks/:taskId/errors`

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| batch | number | - | 按批次筛选 |
| error_code | string | - | 按错误码筛选 |
| page | number | 1 | 页码 |
| page_size | number | 50 | 每页数量 |

### 响应

```json
{
  "errors": [
    {
      "id": "uuid-xxx",
      "task_id": "task_abc",
      "batch_index": 0,
      "row_number": 5,
      "field_name": "SKU编码",
      "raw_value": "SKU_INVALID",
      "error_code": "E001",
      "error_reason": "SKU \"SKU_INVALID\" 在商品主数据中不存在",
      "trace_id": "trace_789",
      "created_at": "2026-08-05T10:00:05Z"
    }
  ],
  "total": 10,
  "page": 1,
  "page_size": 50,
  "total_pages": 1
}
```

### 错误码说明

| 错误码 | 说明 |
|--------|------|
| E001 | SKU 不存在 |
| E002 | 必填字段缺失 |
| E003 | 电话格式错误 |
| E004 | 数量不是正数 |
| E005 | 外部编码重复 |
| E006 | 规则映射失败 |
| E007 | 数据库写入失败 |
| E008 | 文件格式不支持 |

---

## 4. 批次性能查询接口

**GET** `/api/import-tasks/:taskId/batches`

### 响应

```json
{
  "batches": [
    {
      "batch_index": 0,
      "start_row": 1,
      "end_row": 1000,
      "status": "COMPLETED",
      "retry_count": 0,
      "locked_at": "2026-08-05T10:00:01Z",
      "completed_at": "2026-08-05T10:00:06Z",
      "performance": {
        "parse_duration_ms": 450,
        "rule_duration_ms": 1800,
        "validate_duration_ms": 950,
        "insert_duration_ms": 2100,
        "total_duration_ms": 5300
      }
    }
  ]
}
```

---

## 5. 任务列表接口

**GET** `/api/import-tasks/list`

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| limit | number | 50 | 返回数量 |
| offset | number | 0 | 偏移量 |

### 响应

```json
{
  "tasks": [
    {
      "task_id": "task_abc",
      "file_name": "orders.xlsx",
      "status": "COMPLETED",
      "total_rows": 10000,
      "processed_rows": 10000,
      "success_rows": 9990,
      "failed_rows": 10,
      "total_batches": 10,
      "completed_batches": 10,
      "trace_id": "trace_789",
      "degraded": false,
      "created_at": "2026-08-05T10:00:00Z",
      "completed_at": "2026-08-05T10:00:57Z"
    }
  ]
}
```

---

## 6. Trace 查询接口

**GET** `/api/traces/:traceId`

### 响应

```json
{
  "trace_id": "trace_789ghi012jkl",
  "task_id": "task_abc123def456",
  "file_name": "10000-orders.xlsx",
  "status": "COMPLETED",
  "total_rows": 10000,
  "success_rows": 9990,
  "failed_rows": 10,
  "timeline": [
    {
      "occurred_at": "2026-08-05T10:00:00.100Z",
      "event_name": "ImportTaskCreated",
      "event_status": "OK",
      "message": "任务 task_abc 已创建",
      "batch_index": null
    },
    {
      "occurred_at": "2026-08-05T10:00:02.500Z",
      "event_name": "ImportBatchStarted",
      "event_status": "OK",
      "message": "批次 0 开始处理 (行 1-1000)",
      "batch_index": 0
    }
  ]
}
```

---

## 7. Trace 搜索接口

**GET** `/api/import-tasks/search`

### 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| task_id | string | 任务 ID |
| trace_id | string | Trace ID |
| file_name | string | 文件名（模糊匹配） |
| batch_index | number | 批次号 |
| row_number_min | number | 行号下限 |
| row_number_max | number | 行号上限 |
| error_code | string | 错误码 |

### 响应

```json
{
  "tasks": [],
  "errors": [],
  "events": []
}
```

---

## 8. Dispatcher 接口

**POST** `/api/import-tasks/dispatch`

### 说明

内部接口，用于轮询 Outbox 事件并触发 Worker 处理。生产环境建议通过 Vercel Cron Jobs 定时调用（每 2 秒）。

### 响应

```json
{
  "dispatched": 2,
  "elapsed_seconds": 5.3,
  "results": [
    {
      "event_id": "uuid-xxx",
      "batch_index": 0,
      "success": true,
      "successCount": 998,
      "errorCount": 2
    }
  ]
}
```

### 限制

- 单次最多并发处理 2 个批次
- 单次执行超时 50 秒（Vercel 免费版 60s 限制）

---

## 9. 监控聚合接口

**GET** `/api/import-monitor/summary`

### 响应

```json
{
  "throughput_5min": [
    { "minute": "2026-08-05T10:00", "rows": 3000 },
    { "minute": "2026-08-05T10:01", "rows": 2500 }
  ],
  "queue_depth": {
    "pending_batches": 5,
    "pending_rows": 5000,
    "alert": "orange"
  },
  "stage_stats": {
    "parse": { "p50": 450, "p95": 800, "p99": 1200 },
    "rule": { "p50": 1800, "p95": 3000, "p99": 4500 },
    "validate": { "p50": 950, "p95": 2000, "p99": 3500 },
    "insert": { "p50": 2100, "p95": 4000, "p99": 5500 }
  },
  "error_distribution": [
    { "error_code": "E001", "count": 8 },
    { "error_code": "E003", "count": 2 }
  ],
  "recent_tasks": [
    {
      "task_id": "task_abc",
      "file_name": "orders.xlsx",
      "status": "COMPLETED",
      "total_rows": 10000,
      "success_rows": 9990,
      "failed_rows": 10,
      "created_at": "2026-08-05T10:00:00Z"
    }
  ]
}
```
