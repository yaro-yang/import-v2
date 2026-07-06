// V3 数据库初始化
import { NextResponse } from "next/server";
import { initV3DB, initDefaultConfig } from "@/lib/db-v3";

let initialized = false;

export async function GET() {
  if (!initialized) {
    try {
      await initV3DB();
      await initDefaultConfig();
      initialized = true;
    } catch (error) {
      console.error("V3 DB init error:", error);
    }
  }
  return NextResponse.json({ success: true, message: "V3 database initialized" });
}
