// V3 系统配置 - 可配置的阈值和参数
// 所有配置项均可通过数据库动态调整，此处为默认值

export const DEFAULT_CONFIG = {
  // ① 分级审批金额阈值（元）
  approval: {
    level2Threshold: 5000,        // 超过此金额进入二级审批
    currency: "CNY",
  },

  // ② 审批超时时长（小时）
  timeout: {
    level1ReviewHours: 48,        // 一级审批超时：48小时
    level2ReviewHours: 72,        // 二级审批超时：72小时
    pendingTimeoutHours: 24,      // 待审批超时：24小时（直接升级到二级审批）
  },

  // ③ 重新提交次数上限
  resubmit: {
    maxRejectCount: 3,            // 被拒绝后最多重新提交3次
    exceedAction: "auto_close",   // 超过次数后：auto_close(自动关闭) / auto_escalate(强制升级)
  },

  // ④ 物流异常类型 → 下游执行动作映射
  exceptionActionMapping: {
    lost: {
      actions: ["claim", "resend"],
      hasCompensation: true,
      compensationDirection: "to_customer" as const,
      inventoryImpact: "decrease",   // 重新发货扣库存
      description: "丢件：理赔 + 重新发货",
    },
    damaged: {
      actions: ["claim", "return_warehouse"],
      hasCompensation: true,
      compensationDirection: "to_customer" as const,
      inventoryImpact: "increase",   // 退货入库增库存
      description: "破损：理赔 + 退货入库",
    },
    rejected: {
      actions: ["return_warehouse"],
      hasCompensation: false,
      compensationDirection: null,
      inventoryImpact: "increase",
      description: "客户拒收：退货入库，一般不涉及赔付",
    },
    timeout: {
      actions: ["resend"],
      hasCompensation: false,
      compensationDirection: null,
      inventoryImpact: "decrease",
      description: "超时未签收：重新发货，一般不涉及赔付",
    },
    address_error: {
      actions: ["resend"],
      hasCompensation: false,
      compensationDirection: null,
      inventoryImpact: "decrease",
      description: "地址错误：重新发货，一般不涉及赔付",
    },
    // 品控类异常默认映射（实际由品控规则引擎 + 审批结果决定）
    qc_quantity: {
      actions: ["return_supplier", "repurchase"],
      hasCompensation: true,
      compensationDirection: "from_supplier" as const,
      inventoryImpact: "decrease",
      description: "数量不符：退回供应商 + 重新采购，向供应商追偿",
    },
    qc_appearance: {
      actions: ["return_supplier", "repurchase"],
      hasCompensation: true,
      compensationDirection: "from_supplier" as const,
      inventoryImpact: "decrease",
      description: "外观破损：退回供应商 + 重新采购，向供应商追偿",
    },
    qc_spec: {
      actions: ["return_supplier", "repurchase"],
      hasCompensation: true,
      compensationDirection: "from_supplier" as const,
      inventoryImpact: "decrease",
      description: "规格不符：退回供应商 + 重新采购，向供应商追偿",
    },
    qc_label: {
      actions: ["return_supplier"],
      hasCompensation: true,
      compensationDirection: "from_supplier" as const,
      inventoryImpact: "decrease",
      description: "标签错误：退回供应商，向供应商追偿",
    },
    qc_batch: {
      actions: ["return_supplier", "repurchase"],
      hasCompensation: true,
      compensationDirection: "from_supplier" as const,
      inventoryImpact: "decrease",
      description: "批次异常：退回供应商 + 重新采购，向供应商追偿",
    },
  },

  // ⑤ 角色权限划分
  roles: {
    operator: {
      label: "操作员",
      permissions: ["scan", "report_exception", "view_tickets", "view_own_tickets"],
      can_approve: false,
      can_fast_release: false,
      description: "扫描录入、异常上报、查看工单",
    },
    qc_supervisor: {
      label: "品控主管",
      permissions: ["scan", "report_exception", "view_tickets", "fast_release", "manage_qc_rules"],
      can_approve: false,
      can_fast_release: true,
      description: "品控管理、误判快速放行、品控规则配置",
    },
    level1_approver: {
      label: "一级审批人",
      permissions: ["view_tickets", "approve_level1"],
      can_approve: true,
      approvalLevel: 1,
      can_fast_release: false,
      description: "一级审批（金额 ≤ 阈值），不能审批自己上报的工单",
    },
    level2_approver: {
      label: "二级审批人",
      permissions: ["view_tickets", "approve_level2"],
      can_approve: true,
      approvalLevel: 2,
      can_fast_release: false,
      description: "二级审批（金额 > 阈值或升级的工单）",
    },
    admin: {
      label: "管理员",
      permissions: ["*"],
      can_approve: true,
      approvalLevel: 2,
      can_fast_release: true,
      description: "全部权限",
    },
  },

  // ⑦ 品控暂扣超时时长（小时）- 独立于审批超时
  qcHold: {
    timeoutHours: 2,              // 品控暂扣2小时后强制升级二级审批
    reason: "货物压仓产生运营成本，需远短于审批超时（48h）。2小时足够品控主管复核，超时自动升级避免无限期占仓。",
  },

  // ⑧ 品控规则触发阈值（可配置）
  qcRules: {
    defaultRules: [
      {
        name: "数量差异检测",
        exceptionSubType: "qc_quantity" as const,
        conditionField: "quantity_diff_percent",
        conditionOperator: "gt" as const,
        conditionValue: "5",           // 数量差异超过5%
        severity: "high" as const,
        autoCreateTicket: true,
        approvalLevel: 1,
      },
      {
        name: "严重数量差异",
        exceptionSubType: "qc_quantity" as const,
        conditionField: "quantity_diff_percent",
        conditionOperator: "gt" as const,
        conditionValue: "20",          // 数量差异超过20%
        severity: "critical" as const,
        autoCreateTicket: true,
        approvalLevel: 2,
      },
      {
        name: "外观破损检测-轻微",
        exceptionSubType: "qc_appearance" as const,
        conditionField: "damage_level",
        conditionOperator: "gte" as const,
        conditionValue: "1",           // 破损等级 ≥ 1
        severity: "low" as const,
        autoCreateTicket: true,
        approvalLevel: 1,
      },
      {
        name: "外观破损检测-严重",
        exceptionSubType: "qc_appearance" as const,
        conditionField: "damage_level",
        conditionOperator: "gte" as const,
        conditionValue: "3",           // 破损等级 ≥ 3
        severity: "critical" as const,
        autoCreateTicket: true,
        approvalLevel: 2,
      },
      {
        name: "规格偏差检测",
        exceptionSubType: "qc_spec" as const,
        conditionField: "spec_deviation",
        conditionOperator: "gt" as const,
        conditionValue: "0",           // 存在规格偏差
        severity: "medium" as const,
        autoCreateTicket: true,
        approvalLevel: 1,
      },
      {
        name: "标签错误检测",
        exceptionSubType: "qc_label" as const,
        conditionField: "label_match",
        conditionOperator: "eq" as const,
        conditionValue: "false",       // 标签不匹配
        severity: "medium" as const,
        autoCreateTicket: true,
        approvalLevel: 1,
      },
      {
        name: "批次异常检测",
        exceptionSubType: "qc_batch" as const,
        conditionField: "batch_valid",
        conditionOperator: "eq" as const,
        conditionValue: "false",       // 批次无效
        severity: "high" as const,
        autoCreateTicket: true,
        approvalLevel: 2,
      },
    ],
  },

  // ⑨ 品控主管角色权限边界
  qcSupervisorPolicy: {
    canFastRelease: true,
    fastReleaseRequiresReason: true,
    fastReleaseAuditLog: true,
    canManageQCRules: true,
    cannotApprove: true,          // 品控主管不能做审批操作（审批是审批人的职责）
    cannotOverrideApproval: true, // 不能越权覆盖审批结果
    roleOverlapPolicy: "一个人可以同时担任品控主管和审批人，但对自己的工单有操作限制（不能审批自己上报的，不能对自己操作的扫描做快速放行）",
  },

  // V2 接口相关
  v2Api: {
    baseUrl: "/api/v2/external",  // V2外部接口基础路径
    apiKey: "v3-system-api-key-2024",
    timeout: 10000,               // 10秒超时
    retryCount: 2,                // 重试2次
    retryDelay: 1000,             // 重试间隔1秒
  },

  // ⑥ V2数据同步策略
  sync: {
    strategy: "on_demand_with_cache",  // 按需实时拉取 + 本地缓存
    cacheTTLHours: 1,                   // 缓存有效期1小时
    degradeMode: "stale_cache",         // V2不可用时使用过期缓存
    consistencyCheck: "real_time_verify", // 关键操作实时校验
    description: "默认策略：异常上报时实时拉取最新运单信息校验并刷新本地快照；列表展示使用本地快照（1小时有效期）；V2不可用时展示缓存数据并标注来源和时间。",
  },
} as const;
