// V2 外部接口 CORS 中间件
// 为 /api/v2/external/* 路径添加 CORS 头，允许 V3 系统跨域调用
// V3 部署在 Vercel 上，与 V2 不同域，浏览器会拦截跨域请求

import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/api/v2/external/:path*"],
};

export function middleware(request: NextRequest) {
  // 处理 OPTIONS 预检请求
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Request-ID",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // 对实际请求附加 CORS 头
  const response = NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, X-API-Key, X-Request-ID");
  return response;
}
