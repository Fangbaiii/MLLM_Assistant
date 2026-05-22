import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserChatHistory } from "@/server/chat/chat-service";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const sessions = await getUserChatHistory(session.user.id);
  
  return NextResponse.json({ sessions });
}
