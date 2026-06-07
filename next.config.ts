import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // pdfjs-dist 4.x 在服务端需要 node_modules 里的 pdf.worker.mjs 物理文件
  // 1) 标记为 serverExternalPackages：不打包进 .next chunk，避免在部署环境找不到物理文件
  // 2) file-parser.ts 用 createRequire 从 import.meta.url 解析出真实路径
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
