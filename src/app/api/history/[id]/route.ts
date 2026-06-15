import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clearChatSessionMessages,
  deleteChatSession,
  duplicateChatSession,
  renameChatSession,
  togglePinChatSession,
} from "@/server/chat/chat-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  try {
    if (body.clear === true) {
      const cleared = await clearChatSessionMessages(id, session.user.id);
      return NextResponse.json({ success: true, session: cleared });
    }
    if (typeof body.title === "string") {
      await renameChatSession(id, session.user.id, body.title);
    } else if (typeof body.pinned === "boolean") {
      await togglePinChatSession(id, session.user.id, body.pinned);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[History API] PATCH error for session ${id}:`, error);
    return NextResponse.json({ error: "更新会话失败" }, { status: 500 });
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const duplicated = await duplicateChatSession(id, session.user.id);
    return NextResponse.json({ success: true, session: duplicated });
  } catch (error) {
    console.error(`[History API] POST error for session ${id}:`, error);
    return NextResponse.json({ error: "复制会话失败" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteChatSession(id, session.user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[History API] DELETE error for session ${id}:`, error);
    return NextResponse.json({ error: "删除会话失败" }, { status: 500 });
  }
}
