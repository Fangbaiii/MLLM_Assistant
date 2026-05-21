import { NextResponse } from "next/server";
import { initialSessions } from "@/mocks/data";

export async function GET() {
  return NextResponse.json({ sessions: initialSessions });
}
