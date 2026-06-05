import { NextResponse } from "next/server";
import { initDB } from "@/lib/db";

let initialized = false;

export async function GET() {
  if (!initialized) {
    try {
      await initDB();
      initialized = true;
      return NextResponse.json({
        success: true,
        message: "Database initialized",
      });
    } catch (error) {
      console.error("Database init error:", error);
      return NextResponse.json(
        { success: false, message: "Database init failed" },
        { status: 500 }
      );
    }
  }
  return NextResponse.json({ success: true, message: "Already initialized" });
}
