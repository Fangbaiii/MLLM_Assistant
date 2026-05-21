import { NextResponse } from "next/server";
import { resolveModelForMode } from "@/lib/model-routing";
import { buildMockChatResponse } from "@/server/chat/mock-response-builder";
import type { ChatRequest } from "@/types/app";

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest;
  const response = buildMockChatResponse(body);
  const model = resolveModelForMode(body.mode);
  const baseDelay = body.mode === "think" ? 980 : body.mode === "explain" ? 720 : 520;

  await new Promise((resolve) => setTimeout(resolve, baseDelay));

  return NextResponse.json({ ...response, model });
}
