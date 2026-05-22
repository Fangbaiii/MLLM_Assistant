import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  return NextResponse.json({
    hasSession: !!session,
    user: session?.user || null,
  });
}
