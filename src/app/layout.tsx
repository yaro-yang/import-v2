import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { Navigation } from "@/components/layout/Navigation";

export const metadata: Metadata = {
  title: "万能导入 V2 - 智能多格式批量下单系统",
  description: "基于大模型的智能多格式批量下单系统，支持 Excel/Word/PDF 文件解析",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <Navigation />
        <main className="min-h-[calc(100vh-64px)]">
          {children}
        </main>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: {
              fontFamily: "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif",
              fontSize: "14px",
            },
          }}
        />
      </body>
    </html>
  );
}
