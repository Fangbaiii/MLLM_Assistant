import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveModelForMode } from "@/lib/model-routing";
import { buildMockChatResponse } from "@/server/chat/mock-response-builder";
import { saveChatMessage, createChatSession } from "@/server/chat/chat-service";
import { getSystemPrompt } from "@/server/chat/prompt-service";
import { prisma } from "@/lib/prisma";
import type { ChatRequest } from "@/types/app";

export async function POST(request: Request) {
  const session = await auth();
  
  if (!session?.user?.id) {
    console.error("[Chat API] Unauthorized: No user ID in session");
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = (await request.json()) as ChatRequest;
  console.log(`[Chat API] Received request for session: ${body.sessionId}, user: ${session.user.id}, mode: ${body.mode}`);
  
  try {
    // 0. 获取预存的 System Prompt
    const systemPrompt = await getSystemPrompt(body.mode);
    if (systemPrompt) {
      console.log(`[Chat API] Using system prompt for mode ${body.mode}: "${systemPrompt.slice(0, 50)}..."`);
    }

    // 1. 确保会话存在
    let chatSession = await prisma.chatSession.findUnique({
      where: { id: body.sessionId },
    });

    if (!chatSession) {
      console.log(`[Chat API] Creating new session in DB: ${body.sessionId}`);
      chatSession = await createChatSession(
        session.user.id, 
        body.message.slice(0, 50) || "新会话",
        body.sessionId
      );
    }

    // 2. 保存用户消息
    await saveChatMessage(body.sessionId, {
      role: "user",
      content: body.message,
      mode: body.mode,
    });

    // 3. 生成回答（Mock）
    const mockResponse = buildMockChatResponse(body);
    const model = resolveModelForMode(body.mode);
    
    // 4. 保存助手回答
    await saveChatMessage(body.sessionId, {
      role: "assistant",
      content: mockResponse.message.content,
      mode: body.mode,
      reasoning: mockResponse.message.reasoning,
    });

    console.log(`[Chat API] Successfully saved message pair for session: ${body.sessionId}`);

    return NextResponse.json({ ...mockResponse, model });
  } catch (error) {
    console.error("[Chat API] CRITICAL ERROR:", error);
    return NextResponse.json({ error: "服务器保存对话失败" }, { status: 500 });
  }
}
