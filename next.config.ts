import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // pdfjs-dist 4.x 在服务端需要 node_modules 里的 pdf.worker.mjs 物理文件
  // 1) serverExternalPackages：不打包 pdfjs-dist 进 chunk，运行时直接 require
  // 2) outputFileTracingIncludes：standalone build 时把 worker 文件复制到输出目录
  serverExternalPackages: ["pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/pdfjs-dist/build/pdf.worker.mjs", "./node_modules/pdfjs-dist/build/pdf.worker.min.mjs"],
  },
};

export default nextConfig;
