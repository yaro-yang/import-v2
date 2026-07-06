// V3 → V2 接口客户端
// 通过 HTTP 接口与 V2 系统交互，获取运单数据
// 包含鉴权、超时、重试、降级等机制

import { v4 as uuidv4 } from "uuid";
import { ApiSyncLog, OutboundOrder } from "@/types";
import { DEFAULT_CONFIG } from "./config";

const V2_BASE = DEFAULT_CONFIG.v2Api.baseUrl;
const API_KEY = DEFAULT_CONFIG.v2Api.apiKey;
const TIMEOUT = DEFAULT_CONFIG.v2Api.timeout;
const MAX_RETRIES = DEFAULT_CONFIG.v2Api.retryCount;
const RETRY_DELAY = DEFAULT_CONFIG.v2Api.retryDelay;

interface V2Response<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ===== 内部：接口同步日志记录 =====
// 延迟导入避免循环依赖
let _dbV3: typeof import("./db-v3") | null = null;
async function getDbV3() {
  if (!_dbV3) {
    _dbV3 = await import("./db-v3");
  }
  return _dbV3;
}

async function logApiCall(logData: Omit<ApiSyncLog, "id" | "createdAt">): Promise<void> {
  try {
    const db = await getDbV3();
    await db.saveApiSyncLog({
      ...logData,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    });
  } catch {
    // 日志记录失败不应阻塞主流程
    console.warn("[V2 Client] Failed to save API sync log");
  }
}

// ===== 核心：带鉴权、超时、重试的 fetch 封装 =====
async function fetchWithAuth<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: string | null; log: Partial<ApiSyncLog> }> {
  const requestId = uuidv4();
  const startTime = Date.now();
  const fullUrl = `${V2_BASE}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
    "X-Request-ID": requestId,
    ...((options.headers as Record<string, string>) || {}),
  };

  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * attempt));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

      const response = await fetch(fullUrl, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const errorMsg = `V2 returned ${response.status}: ${body.slice(0, 200)}`;
        
        // 4xx 错误不重试（客户端错误）
        if (response.status >= 400 && response.status < 500) {
          await logApiCall({
            requestId,
            apiName: path,
            requestParams: { method: options.method || "GET", path },
            responseStatus: response.status,
            responseSummary: body.slice(0, 300),
            durationMs,
            success: false,
            errorMessage: errorMsg,
          });
          return { data: null, error: errorMsg, log: { requestId, apiName: path } };
        }

        // 5xx 错误可重试
        if (attempt < MAX_RETRIES) continue;
        
        await logApiCall({
          requestId,
          apiName: path,
          requestParams: { method: options.method || "GET", path },
          responseStatus: response.status,
          responseSummary: body.slice(0, 300),
          durationMs,
          success: false,
          errorMessage: errorMsg,
        });
        return { data: null, error: errorMsg, log: { requestId, apiName: path } };
      }

      const result = (await response.json()) as V2Response<T>;
      const durationMsFinal = Date.now() - startTime;

      if (!result.success || result.error) {
        await logApiCall({
          requestId,
          apiName: path,
          requestParams: { method: options.method || "GET", path },
          responseStatus: response.status,
          responseSummary: result.error || "Unknown error",
          durationMs: durationMsFinal,
          success: false,
          errorMessage: result.error || "V2 returned success=false",
        });
        return { data: null, error: result.error || "Unknown error", log: { requestId, apiName: path } };
      }

      await logApiCall({
        requestId,
        apiName: path,
        requestParams: { method: options.method || "GET", path },
        responseStatus: response.status,
        responseSummary: "OK",
        durationMs: durationMsFinal,
        success: true,
      });

      return { data: result.data as T, error: null, log: { requestId, apiName: path } };
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      const errorMsg = isTimeout ? "V2 interface timeout" : (err instanceof Error ? err.message : "Network error");
      lastError = errorMsg;

      if (attempt < MAX_RETRIES) continue;

      const durationMs = Date.now() - startTime;
      await logApiCall({
        requestId,
        apiName: path,
        requestParams: { method: options.method || "GET", path },
        responseStatus: isTimeout ? 408 : 0,
        responseSummary: errorMsg,
        durationMs,
        success: false,
        errorMessage: errorMsg,
      });
      return { data: null, error: errorMsg, log: { requestId, apiName: path } };
    }
  }

  return { data: null, error: lastError || "Unknown error", log: { requestId, apiName: path } };
}

// ===== 对外接口 =====

/**
 * 校验运单是否存在 + 获取运单详情
 */
export async function getWaybillDetail(waybillId: string): Promise<{
  waybill: OutboundOrder | null;
  error: string | null;
}> {
  // 尝试从 V2 本地数据库直接读取（同一项目内可直连）
  try {
    const { getOrderById } = await import("./db");
    const order = await getOrderById(waybillId);
    if (order) {
      return { waybill: order, error: null };
    }
  } catch {
    // 直连失败，走 HTTP
  }

  const { data, error } = await fetchWithAuth<OutboundOrder>(
    `/waybills/${encodeURIComponent(waybillId)}`
  );
  return { waybill: data, error };
}

/**
 * 按运单号查询运单
 */
export async function getWaybillByExternalCode(externalCode: string): Promise<{
  waybills: OutboundOrder[];
  error: string | null;
}> {
  // 先从本地 V2 DB 查询
  try {
    const { getOrders } = await import("./db");
    const result = await getOrders({ externalCode, pageSize: 100 });
    if (result.orders.length > 0) {
      return { waybills: result.orders, error: null };
    }
  } catch {
    // 直连失败，走 HTTP
  }

  const { data, error } = await fetchWithAuth<OutboundOrder[]>(
    `/waybills?externalCode=${encodeURIComponent(externalCode)}`
  );
  return { waybills: data || [], error };
}

/**
 * 按条件查询/同步运单列表
 */
export async function listWaybills(params?: {
  externalCode?: string;
  recipientName?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  waybills: OutboundOrder[];
  total: number;
  error: string | null;
}> {
  try {
    const { getOrders } = await import("./db");
    const result = await getOrders(params);
    return { waybills: result.orders, total: result.total, error: null };
  } catch {
    // 直连失败，走 HTTP
  }

  const queryParts: string[] = [];
  if (params?.externalCode) queryParts.push(`externalCode=${encodeURIComponent(params.externalCode)}`);
  if (params?.recipientName) queryParts.push(`recipientName=${encodeURIComponent(params.recipientName)}`);
  if (params?.page) queryParts.push(`page=${params.page}`);
  if (params?.pageSize) queryParts.push(`pageSize=${params.pageSize}`);

  const { data, error } = await fetchWithAuth<{ orders: OutboundOrder[]; total: number }>(
    `/waybills${queryParts.length > 0 ? "?" + queryParts.join("&") : ""}`
  );
  return { waybills: data?.orders || [], total: data?.total || 0, error };
}

/**
 * 校验 SKU 是否归属于指定运单
 */
export async function verifySkuBelongsToWaybill(
  waybillId: string,
  skuCode: string
): Promise<{
  valid: boolean;
  waybill?: OutboundOrder;
  error?: string;
}> {
  // 先从 V2 本地 DB 查询
  try {
    const { getOrderById } = await import("./db");
    const order = await getOrderById(waybillId);
    if (order) {
      const hasSku = order.items?.some((item) => item.skuCode === skuCode);
      return { valid: !!hasSku, waybill: order };
    }
  } catch {
    // 直连失败，走 HTTP
  }

  const { data, error } = await fetchWithAuth<{ valid: boolean; waybill?: OutboundOrder }>(
    `/verify-sku`,
    {
      method: "POST",
      body: JSON.stringify({ waybillId, skuCode }),
    }
  );
  if (error) return { valid: false, error };
  return { valid: data?.valid || false, waybill: data?.waybill };
}

/**
 * 获取同步监控数据
 */
export async function getSyncStats(): Promise<{
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  lastSyncTime: string | null;
  successRate: number;
  recentLogs: ApiSyncLog[];
}> {
  try {
    const db = await getDbV3();
    return await db.getSyncStats();
  } catch {
    return {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      lastSyncTime: null,
      successRate: 0,
      recentLogs: [],
    };
  }
}

/**
 * 健康检查 - V2 服务是否可用
 */
export async function checkV2Health(): Promise<{ healthy: boolean; latency: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${V2_BASE}/health`, {
      signal: controller.signal,
      headers: { "X-API-Key": API_KEY },
    });
    clearTimeout(timeoutId);
    return { healthy: response.ok, latency: Date.now() - start };
  } catch {
    return { healthy: false, latency: Date.now() - start };
  }
}
