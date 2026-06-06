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
