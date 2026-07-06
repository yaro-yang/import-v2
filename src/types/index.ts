// 解析规则类型定义

// 字段映射模式
export type FieldMappingMode =
  | "column_index"      // 按列索引映射
  | "column_name"       // 按列名映射
  | "row_field"         // 从行中提取字段（key:value 模式）
  | "regex_extract"     // 正则提取
  | "static_value"      // 静态值
  | "ai_infer"          // AI 推断
  | "matrix_transpose"  // 矩阵转置
  | "card_split"        // 卡片拆分
  | "composite_split"   // 复合单元格拆分
  | "tail_extract";     // 尾部信息提取

// 单个字段映射规则
export interface FieldMapping {
  targetField: string;          // 目标字段名
  mode: FieldMappingMode;
  // column_index / column_name 模式
  columnIndex?: number;
  columnName?: string;
  // row_field 模式
  rowKeyPattern?: string;       // 行中匹配 key 的正则
  rowValuePattern?: string;     // 行中提取 value 的正则
  // regex_extract 模式
  regexPattern?: string;
  regexGroup?: number;
  // static_value 模式
  staticValue?: string;
  // ai_infer 模式
  aiPrompt?: string;
  // 默认值
  defaultValue?: string;
  // 是否必填
  required?: boolean;
}

// 数据区配置
export interface DataRegionConfig {
  // 数据起始行（0-based，跳过干扰头部）
  skipRows?: number;
  // 数据结束行（可选，用于排除尾部）
  endRows?: number;
  // 表头行（0-based）
  headerRow?: number;
  // 多 Sheet 处理
  sheetNames?: string[];        // 指定要处理的 sheet，空表示全部
  sheetPattern?: string;        // sheet 名正则匹配
  // 尾部信息区
  tailRegion?: {
    startRow?: number;          // 尾部信息起始行
    endRow?: number;            // 尾部信息结束行
    fields: FieldMapping[];     // 从尾部提取的字段
  };
  // 卡片模式
  cardMode?: {
    enabled: boolean;
    startMarker: string;        // 卡片起始标志（如 "▶ 调拨记录"）
    endMarker?: string;         // 卡片结束标志
    fieldsBeforeTable?: FieldMapping[];  // 卡片标题区域的字段
  };
  // 矩阵转置模式
  matrixMode?: {
    enabled: boolean;
    rowHeaderColumn?: number;   // 行头所在列（如 SKU 编码列）
    valueColumnsStart?: number; // 数值列起始索引
    valueColumnsEnd?: number;   // 数值列结束索引
    valueColumnNamesRow?: number; // 列名所在行
    storeColumnNames?: string[];  // 门店列名列表（如 ["银泰", "金银潭", "金桥"]）
    storeColumnIndices?: number[]; // 门店列索引（0-based，如 [13, 14, 15, 16, 17]）
  };
  // 复合单元格模式
  compositeMode?: {
    enabled: boolean;
    separator: string;          // 分隔符（如 "\n"）
    pattern: string;            // 提取模式（如 "(.+?)x(\\d+)"）
  };
}

// 解析规则
export interface ParseRule {
  id: string;
  name: string;
  description?: string;
  fileType: "excel" | "word" | "pdf";
  // 全局配置
  globalConfig: {
    // 业务模式：
    //   - "outbound"  默认：普通出库单，1 外部编码 = 1 父单，共享收货信息
    //   - "transfer"  调拨单：1 外部编码 = 1 调拨单，按 (外部编码+收货门店) 拆成多个调拨明细
    mode?: "outbound" | "transfer";
    // 按外部编码聚合（同一外部编码的多行共享收货信息；outbound 模式生效）
    groupByExternalCode?: boolean;
    externalCodeField?: string;
    // 合并多 sheet
    mergeSheets?: boolean;
    // 文件编码
    encoding?: string;
  };
  // 字段映射列表
  fieldMappings: FieldMapping[];
  // 数据区配置
  dataRegion: DataRegionConfig;
  // 额外处理
  postProcessing?: {
    // 跳过合计行
    skipTotalRow?: boolean;
    totalRowPattern?: string;
    // 文本分隔符（用于纯文本解析）
    textSeparator?: string;
    textRecordMarker?: string;
  };
  // 元信息
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  // AI 生成标记
  aiGenerated?: boolean;
  aiConfidence?: number;        // AI 置信度
  aiNotes?: string;             // AI 推测说明
}

// 温层允许值（业务约定）
export const TEMPERATURE_LEVELS = ["常温", "冷藏", "冷冻", "冰温", "深冷"] as const;
export type TemperatureLevel = typeof TEMPERATURE_LEVELS[number];

// 运单数据（解析后的结构化数据，SKU 粒度：每个 SKU 一条记录）
// 同一 externalCode 下的多条 OrderItem 共享父单（OutboundOrder）信息
export interface OrderItem {
  id: string;
  // 外部系统订单唯一编号（用于聚合/去重）
  externalCode?: string;
  // 父出库单 ID（运行时关联，DB 落库时填充）
  outboundOrderId?: string;
  // 导入批次 ID（前端在每次提交时生成；空 externalCode 时用于按批次聚合展示）
  batchId?: string;
  // A组：门店模式
  storeName?: string;
  // B组：收件人模式
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  // SKU 信息（每条记录只对应一个 SKU）
  skuCode: string;
  skuName: string;
  skuQuantity: number;
  skuSpec?: string;
  // 物理属性（可选，按业务需要填写）
  weight?: number;                       // 重量（kg）
  temperatureLevel?: TemperatureLevel;   // 温层
  // 备注
  remark?: string;
  // 元信息
  sourceFile?: string;
  sourceSheet?: string;
  sourceRow?: number;
  ruleId?: string;
  // 状态
  status: "draft" | "submitted" | "error";
  errors?: ValidationError[];
  // 时间
  createdAt: string;
  submittedAt?: string;
}

// 父出库单：按 externalCode 聚合的容器
// 同一 externalCode 下的多个 OrderItem（SKU 行）共享一组收货信息
export interface OutboundOrder {
  id: string;
  externalCode?: string;        // 外部系统订单唯一编号
  storeName?: string;            // 收货门店
  recipientName?: string;        // 收件人
  recipientPhone?: string;       // 电话
  recipientAddress?: string;     // 地址
  remark?: string;               // 父单备注
  // 导入批次 ID（前端在每次提交时生成；空 externalCode 时用于按批次聚合展示）
  batchId?: string;
  // 元信息
  sourceFile?: string;
  sourceSheet?: string;
  sourceRow?: number;
  ruleId?: string;
  status: "draft" | "submitted" | "error";
  // 调拨单模式：所属调拨单 ID（指向 transfer_orders.id）
  transferOrderId?: string;
  // 子项：SKU 行
  items: OrderItem[];
  // 时间
  createdAt: string;
  submittedAt?: string;
}

// 调拨单（transfer mode 顶层）
// 1 个调拨单 = 1 个外部编码（DB20260530001）
// 1 个调拨单包含 N 个调拨明细（按 externalCode+storeName 分组）
// 1 个调拨明细包含 M 条 SKU 明细
export interface TransferOrder {
  id: string;
  externalCode: string;          // 调拨单号（唯一标识）
  remark?: string;               // 调拨单级备注
  sourceFile?: string;
  sourceSheet?: string;
  ruleId?: string;
  status: "draft" | "submitted" | "error";
  // 调拨明细（每个明细对应一个收货门店）
  details: OutboundOrder[];
  createdAt: string;
  submittedAt?: string;
}

// 校验错误
export interface ValidationError {
  row: number;
  field: string;
  message: string;
  severity: "error" | "warning";
}

// AI 解析请求
export interface AIAnalyzeRequest {
  fileContent: string;          // 文件内容的文本表示
  fileName: string;
  fileType: "excel" | "word" | "pdf";
  sampleRows?: string[][];      // 前几行样例数据
}

// AI 解析响应
export interface AIAnalyzeResponse {
  suggestedRule: Partial<ParseRule>;
  confidence: number;
  notes: string;
  fieldMappings: {
    targetField: string;
    suggestedSource: string;
    confidence: number;
    note?: string;
  }[];
}

// 上传文件信息
export interface UploadedFile {
  name: string;
  size: number;
  type: string;
  content: ArrayBuffer;
}

// 解析结果
export interface ParseResult {
  orders: OrderItem[];
  totalCount: number;
  successCount: number;
  errorCount: number;
  errors: ValidationError[];
  parseTime: number;
}

// API 响应
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ============================================================
// V3 运单全流程管理系统 - 类型定义
// ============================================================

// 异常类型（物流类 + 品控类）
export type ExceptionType =
  // 物流类异常（手工上报）
  | "lost"           // 丢件
  | "damaged"        // 破损
  | "rejected"       // 客户拒收
  | "timeout"        // 超时未签收
  | "address_error"  // 收货地址错误
  // 品控类异常（扫描自动触发）
  | "qc_quantity"    // 数量不符
  | "qc_appearance"  // 外观破损
  | "qc_spec"        // 规格不符
  | "qc_label"       // 标签错误
  | "qc_batch";      // 批次异常

export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  lost: "丢件",
  damaged: "破损",
  rejected: "客户拒收",
  timeout: "超时未签收",
  address_error: "收货地址错误",
  qc_quantity: "数量不符",
  qc_appearance: "外观破损",
  qc_spec: "规格不符",
  qc_label: "标签错误",
  qc_batch: "批次异常",
};

// 异常来源
export type ExceptionSource = "manual" | "scan_trigger";

// 工单状态
export type TicketStatus = 
  | "pending"          // 待审批
  | "level1_review"    // 一级审批中
  | "level2_review"    // 二级审批中
  | "executing"        // 执行中
  | "completed"        // 已完成
  | "rejected_final";  // 最终驳回（超过重提次数）

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  pending: "待审批",
  level1_review: "一级审批中",
  level2_review: "二级审批中",
  executing: "执行中",
  completed: "已完成",
  rejected_final: "已驳回",
};

// 审批动作
export type ApprovalAction = "approve" | "reject" | "escalate";

// 审批触发方式
export type ApprovalTrigger = "manual" | "auto_timeout" | "auto_escalation";

// 赔付方向
export type CompensationDirection = "to_customer" | "from_supplier";

// 批次状态
export type BatchStatus = "normal" | "qc_hold" | "released";

// 扫描QC结果
export type QCResult = "pass" | "fail";

// 执行动作类型
export type ExecutionAction =
  | "release"           // 放行货物
  | "return_supplier"   // 退回供应商
  | "repurchase"        // 重新采购
  | "downgrade"         // 降级处理
  | "claim"             // 理赔
  | "resend"            // 重新发货
  | "return_warehouse"; // 退货入库

// ===== 数据模型 =====

// 运单本地快照
export interface WaybillSnapshot {
  id: string;
  waybillId: string;           // V2 outbound_orders.id
  externalCode?: string;
  storeName?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  totalAmount: number;
  skuCount: number;
  rawData: Record<string, unknown>;
  syncedAt: string;
  dataVersion: number;
}

// 接口同步日志
export interface ApiSyncLog {
  id: string;
  requestId: string;
  apiName: string;
  requestParams: Record<string, unknown>;
  responseStatus?: number;
  responseSummary?: string;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
  createdAt: string;
}

// 异常工单
export interface ExceptionTicket {
  id: string;
  ticketNo: string;
  waybillSnapshotId?: string;
  waybillSnapshot?: WaybillSnapshot;
  exceptionType: ExceptionType;
  exceptionSource: ExceptionSource;
  description: string;
  amount: number;
  reporter: string;
  reporterRole: string;
  status: TicketStatus;
  currentLevel: number;
  rejectCount: number;
  maxRejectCount: number;
  timeoutAt?: string;
  version: number;
  approvalRecords?: ApprovalRecord[];
  compensationRecord?: CompensationRecord;
  executionAction?: ExecutionAction;
  createdAt: string;
  updatedAt: string;
}

// 审批记录
export interface ApprovalRecord {
  id: string;
  ticketId: string;
  ticketNo: string;
  approver: string;
  approverRole: string;
  level: number;
  action: ApprovalAction;
  opinion?: string;
  triggeredBy: ApprovalTrigger;
  createdAt: string;
}

// 赔付记录
export interface CompensationRecord {
  id: string;
  ticketId: string;
  approvalRecordId?: string;
  compensationDirection: CompensationDirection;
  amount: number;
  status: "pending" | "processed";
  description?: string;
  createdAt: string;
}

// 库存记录
export interface InventoryRecord {
  id: string;
  skuCode: string;
  skuName?: string;
  warehouse?: string;
  quantity: number;
  lockedQuantity: number;
  availableQuantity: number;
  batchNo?: string;
  status: "available" | "qc_hold" | "locked";
  updatedAt: string;
}

// 扫描记录
export interface ScanRecord {
  id: string;
  waybillSnapshotId?: string;
  externalCode?: string;
  skuCode: string;
  skuName?: string;
  batchNo?: string;
  scanTime: string;
  operator: string;
  deviceId?: string;
  qcResult: QCResult;
  failReason?: string;
  triggeredRuleId?: string;
  triggeredRuleName?: string;
  batchStatus: BatchStatus;
  ticketId?: string;
  createdAt: string;
}

// 品控规则
export interface QCRule {
  id: string;
  name: string;
  exceptionSubType: ExceptionType;
  conditionField: string;
  conditionOperator: "gt" | "lt" | "gte" | "lte" | "eq" | "neq" | "contains";
  conditionValue: string;
  severity: "low" | "medium" | "high" | "critical";
  autoCreateTicket: boolean;
  approvalLevel: number;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

// 审批配置
export interface ApprovalConfig {
  id: string;
  configKey: string;
  configValue: string;
  description?: string;
  updatedAt: string;
}

// 角色类型
export type UserRole = "operator" | "qc_supervisor" | "level1_approver" | "level2_approver" | "admin";

// 当前用户信息
export interface CurrentUser {
  id: string;
  name: string;
  role: UserRole;
  warehouse?: string;
}

// 模拟用户（演示用）
export const MOCK_USERS: CurrentUser[] = [
  { id: "user_op_01", name: "张三（操作员）", role: "operator", warehouse: "WH-01" },
  { id: "user_qc_01", name: "李四（品控主管）", role: "qc_supervisor", warehouse: "WH-01" },
  { id: "user_l1_01", name: "王五（一级审批）", role: "level1_approver", warehouse: "WH-01" },
  { id: "user_l2_01", name: "赵六（二级审批）", role: "level2_approver", warehouse: "WH-01" },
  { id: "user_admin", name: "管理员", role: "admin", warehouse: "WH-01" },
];
