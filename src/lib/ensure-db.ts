// 确保数据库已初始化的工具函数
// 在服务端 API 路由中首次调用时自动建表

import { initDB } from "@/lib/db";

let dbReady = false;
let dbInitPromise: Promise<void> | null = null;

export async function ensureDB(): Promise<void> {
  if (dbReady) return;
  if (dbInitPromise) {
    await dbInitPromise;
    return;
  }
  dbInitPromise = initDB().then(() => {
    dbReady = true;
    dbInitPromise = null;
  });
  await dbInitPromise;
}
