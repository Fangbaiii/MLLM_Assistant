import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildMockChatResponse } from "@/server/chat/mock-response-builder";
import { createChatSession, saveChatMessage, updateChatSessionModel } from "@/server/chat/chat-service";
import { getSystemPrompt } from "@/server/chat/prompt-service";
import { streamModelChatResponse } from "@/server/model/openai-compatible-client";
import { prisma } from "@/lib/prisma";
import type { ChatRequest, ChatResponse, EvidenceItem, OcrBlock } from "@/types/app";

export const runtime = "nodejs";

function isMockFallbackEnabled() {
  return process.env.MLLM_ENABLE_MOCK_FALLBACK === "true";
}

async function generateResponse(body: ChatRequest): Promise<ChatResponse> {
  return buildMockChatResponse(body);
}

function streamHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
}

function serializeSseEvent(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: Request) {
  const session = await auth();
  
  if (!session?.user?.id) {
    console.error("[Chat API] Unauthorized: No user ID in session");
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = (await request.json()) as ChatRequest;
  console.log(`[Chat API] Received request for session: ${body.sessionId}, user: ${session.user.id}, mode: ${body.mode}`);
  
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(serializeSseEvent(event, payload)));
      };

      void (async () => {
        try {
          const systemPrompt = await getSystemPrompt(body.mode);
          if (systemPrompt) {
            console.log(`[Chat API] Using system prompt for mode ${body.mode}: "${systemPrompt.slice(0, 50)}..."`);
          }

          let chatSession = await prisma.chatSession.findUnique({
            where: { id: body.sessionId },
          });

          if (!chatSession) {
            console.log(`[Chat API] Creating new session in DB: ${body.sessionId}`);
            chatSession = await createChatSession(
              session.user.id,
              body.message.slice(0, 50) || "新会话",
              body.sessionId,
            );
          }

          const savedUserMessage = await saveChatMessage(body.sessionId, {
            role: "user",
            content: body.message,
            mode: body.mode,
          });

          let fullContent = "";
          let model = "unknown";
          let reasoning = "模型推理已完成。";
          let ocrBlocks: OcrBlock[] = [];
          let evidence: EvidenceItem[] = [];

          try {
            const streamResult = await streamModelChatResponse(
              {
                request: body,
                userId: session.user.id,
                systemPrompt,
                excludeMessageIds: [savedUserMessage.id],
              },
              {
                onToken(token) {
                  fullContent += token;
                  send("delta", { text: token });
                },
              },
            );

            model = streamResult.model;
            reasoning = streamResult.reasoning;
            ocrBlocks = streamResult.ocrBlocks;
            evidence = streamResult.evidence;
            fullContent = streamResult.content;
          } catch (error) {
            if (!isMockFallbackEnabled()) {
              throw error;
            }
            console.warn("[Chat API] Model call failed; using explicit mock fallback.", error);
            const mockResponse = await generateResponse(body);
            model = mockResponse.model ?? "mock-fallback";
            reasoning = mockResponse.message.reasoning || "mock fallback";
            ocrBlocks = mockResponse.ocrBlocks;
            evidence = mockResponse.message.evidence || [];
            fullContent = mockResponse.message.content;
            send("delta", { text: fullContent });
          }

          await saveChatMessage(body.sessionId, {
            role: "assistant",
            content: fullContent,
            mode: body.mode,
            reasoning,
          });
          await updateChatSessionModel(body.sessionId, session.user.id, model);

          send("meta", {
            model,
            mode: body.mode,
            reasoning,
            evidence,
            ocrBlocks,
          });
          send("done", { ok: true });
        } catch (error) {
          console.error("[Chat API] CRITICAL ERROR:", error);
          const message = error instanceof Error ? error.message : "模型服务暂时不可用，请稍后重试。";
          send("error", { message });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, { headers: streamHeaders() });
}
