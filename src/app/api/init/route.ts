import { NextResponse } from "next/server";
import { initDB } from "@/lib/db";

export async function POST() {
  try {
    await initDB();
    return NextResponse.json({
      success: true,
      message: "Database initialized (tables created if not exists)",
    });
  } catch (error) {
    console.error("Database init error:", error);
    return NextResponse.json(
      { success: false, message: "Database init failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}
