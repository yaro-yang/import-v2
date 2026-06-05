import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { Navigation } from "@/components/layout/Navigation";

export const metadata: Metadata = {
  title: "万能导入 - 智能多格式批量下单系统",
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
        <main className="main-content ml-[200px] lg:ml-[200px] mt-[56px] min-h-[calc(100vh-56px)] bg-[#f7f8fa] flex flex-col">
          <div className="flex-1 w-full max-w-[1400px] mx-auto px-5 lg:px-8 py-20 lg:py-28">
            {children}
          </div>
        </main>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: {
              fontFamily: "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif",
              fontSize: "14px",
              borderRadius: "8px",
              padding: "12px 16px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            },
            success: {
              iconTheme: {
                primary: "#0fc6c2",
                secondary: "#fff",
              },
              style: {
                border: "1px solid #e8fafa",
                background: "#f0fdfd",
              },
            },
            error: {
              iconTheme: {
                primary: "#cf1322",
                secondary: "#fff",
              },
              style: {
                border: "1px solid #ffccc7",
                background: "#fff1f0",
              },
            },
            loading: {
              style: {
                border: "1px solid #e8fafa",
                background: "#f0fdfd",
              },
            },
          }}
        />
      </body>
    </html>
  );
}
