import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildMockChatResponse } from "@/server/chat/mock-response-builder";
import {
  getOrCreateChatSession,
  getRecentAttachmentIds,
  saveChatMessage,
  updateChatSessionModel,
} from "@/server/chat/chat-service";
import { getSystemPrompt } from "@/server/chat/prompt-service";
import { streamModelChatResponse } from "@/server/model/openai-compatible-client";
import { getStoredUploadUrl, loadAttachmentContext } from "@/server/upload/upload-artifact-service";
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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isValidMode(mode: unknown): mode is ChatRequest["mode"] {
  return mode === "default" || mode === "explain" || mode === "think";
}

export async function POST(request: Request) {
  const session = await auth();
  
  if (!session?.user?.id) {
    console.error("[Chat API] Unauthorized: No user ID in session");
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = (await request.json()) as ChatRequest;
  if (!body.sessionId || typeof body.message !== "string" || !isValidMode(body.mode) || !Array.isArray(body.attachmentIds)) {
    return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
  }
  console.log(`[Chat API] Received request for session: ${body.sessionId}, user: ${session.user.id}, mode: ${body.mode}`);
  
  const encoder = new TextEncoder();
  let clientAborted = request.signal.aborted;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        if (!clientAborted) {
          controller.enqueue(encoder.encode(serializeSseEvent(event, payload)));
        }
      };
      const markClientAborted = () => {
        clientAborted = true;
      };
      request.signal.addEventListener("abort", markClientAborted, { once: true });

      void (async () => {
        try {
          const systemPrompt = await getSystemPrompt(body.mode);
          if (systemPrompt) {
            console.log(`[Chat API] Using system prompt for mode ${body.mode}: "${systemPrompt.slice(0, 50)}..."`);
          }

          await getOrCreateChatSession(
            session.user.id,
            body.message.slice(0, 50) || "新会话",
            body.sessionId,
          );

          const resolvedAttachmentIds = await getRecentAttachmentIds({
            sessionId: body.sessionId,
            userId: session.user.id,
            explicitAttachmentIds: body.attachmentIds,
          });
          const requestWithResolvedAttachments: ChatRequest = {
            ...body,
            attachmentIds: resolvedAttachmentIds,
          };
          const attachmentContext = await loadAttachmentContext(resolvedAttachmentIds, session.user.id);
          const savedUserMessage = await saveChatMessage(body.sessionId, {
            userId: session.user.id,
            role: "user",
            content: body.message,
            mode: body.mode,
            attachments: attachmentContext.artifacts.map((artifact) => ({
              id: artifact.assetId,
              name: artifact.name,
              type: artifact.type,
              size: artifact.size,
              previewUrl: getStoredUploadUrl(artifact.assetId),
              progress: 100,
              status: "complete" as const,
              routing: artifact.routing,
            })),
          });

          let fullContent = "";
          let model = "unknown";
          let reasoning = "模型推理已完成。";
          let finishReason = "unknown";
          let ocrBlocks: OcrBlock[] = [];
          let evidence: EvidenceItem[] = [];

          try {
	            const streamResult = await streamModelChatResponse(
	              {
	                request: requestWithResolvedAttachments,
	                userId: session.user.id,
	                systemPrompt,
	                excludeMessageIds: [savedUserMessage.id],
	                attachmentContext,
	                signal: request.signal,
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
            finishReason = streamResult.finishReason;
            ocrBlocks = streamResult.ocrBlocks;
            evidence = streamResult.evidence;
            fullContent = streamResult.content;
          } catch (error) {
            if (isAbortError(error)) {
              finishReason = "cancelled";
              reasoning = "用户已停止本次生成。";
            } else if (!isMockFallbackEnabled()) {
              throw error;
            } else {
              console.warn("[Chat API] Model call failed; using explicit mock fallback.", error);
              const mockResponse = await generateResponse(body);
              model = mockResponse.model ?? "mock-fallback";
              reasoning = mockResponse.message.reasoning || "mock fallback";
              ocrBlocks = mockResponse.ocrBlocks;
              evidence = mockResponse.message.evidence || [];
              fullContent = mockResponse.message.content;
              finishReason = "mock";
              send("delta", { text: fullContent });
            }
          }

          if (fullContent.trim()) {
            await saveChatMessage(body.sessionId, {
              userId: session.user.id,
              role: "assistant",
              content: fullContent,
              mode: body.mode,
              reasoning,
            });
          }
          if (model !== "unknown") {
            await updateChatSessionModel(body.sessionId, session.user.id, model);
          }

          send("meta", {
            model,
            mode: body.mode,
            reasoning,
            evidence,
            ocrBlocks,
            finishReason,
          });
          send("done", { ok: true });
        } catch (error) {
          if (isAbortError(error) || clientAborted) {
            return;
          }
          console.error("[Chat API] CRITICAL ERROR:", error);
          const message = error instanceof Error ? error.message : "模型服务暂时不可用，请稍后重试。";
          send("error", { message });
        } finally {
          request.signal.removeEventListener("abort", markClientAborted);
          if (!clientAborted) {
            controller.close();
          }
        }
      })();
    },
    cancel() {
      clientAborted = true;
    },
  });

  return new Response(stream, { headers: streamHeaders() });
}
