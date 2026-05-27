import { prisma } from "@/lib/prisma";

export type ContextMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: string | null;
  createdAt: string;
};

const DEFAULT_CONTEXT_WINDOW_CHARS = 18_000;
const DEFAULT_CONTEXT_MAX_MESSAGES = 16;

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeMessageContent(content: string) {
  return content.replace(/\s+/g, " ").trim();
}

function estimateMessageCost(content: string) {
  return normalizeMessageContent(content).length + 32;
}

export async function getUserChatHistory(userId: string) {
  try {
    console.log(`[ChatService] Fetching history for user: ${userId}`);
    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    console.log(`[ChatService] Found ${sessions.length} sessions`);

    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      model: s.model,
      updatedAt: s.updatedAt.toISOString(),
      pinned: s.pinned,
      summary: s.summary,
      messages: s.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        mode: m.mode,
        reasoning: m.reasoning,
        createdAt: m.createdAt.toISOString(),
      })),
    }));
  } catch (error) {
    console.error("[ChatService] Error fetching history:", error);
    return [];
  }
}

export async function createChatSession(userId: string, title: string, sessionId?: string) {
  console.log(`[ChatService] Creating session for user: ${userId}, title: ${title}`);
  return prisma.chatSession.create({
    data: {
      id: sessionId,
      userId,
      title,
    },
  });
}

export async function updateChatSessionModel(sessionId: string, userId: string, model: string) {
  return prisma.chatSession.update({
    where: { id: sessionId, userId },
    data: { model },
  });
}

export async function renameChatSession(sessionId: string, userId: string, title: string) {
  console.log(`[ChatService] Renaming session: ${sessionId} to: ${title}`);
  return prisma.chatSession.update({
    where: { id: sessionId, userId },
    data: { title },
  });
}

export async function togglePinChatSession(sessionId: string, userId: string, pinned: boolean) {
  console.log(`[ChatService] Toggling pin for session: ${sessionId} to: ${pinned}`);
  return prisma.chatSession.update({
    where: { id: sessionId, userId },
    data: { pinned },
  });
}

export async function deleteChatSession(sessionId: string, userId: string) {
  console.log(`[ChatService] Deleting session: ${sessionId}`);
  return prisma.chatSession.delete({
    where: { id: sessionId, userId },
  });
}

export async function saveChatMessage(sessionId: string, data: {
  role: string;
  content: string;
  mode?: string;
  reasoning?: string;
}) {
  console.log(`[ChatService] Saving message to session: ${sessionId}, role: ${data.role}`);
  return prisma.chatMessage.create({
    data: {
      sessionId,
      role: data.role,
      content: data.content,
      mode: data.mode,
      reasoning: data.reasoning,
    },
  });
}

export async function getTrimmedConversationContext(params: {
  sessionId: string;
  userId: string;
  excludeMessageIds?: string[];
}) {
  const maxWindowChars = parsePositiveInt(
    process.env.MLLM_CONTEXT_WINDOW_CHARS,
    DEFAULT_CONTEXT_WINDOW_CHARS,
  );
  const maxMessages = parsePositiveInt(
    process.env.MLLM_CONTEXT_MAX_MESSAGES,
    DEFAULT_CONTEXT_MAX_MESSAGES,
  );
  const excludeMessageIds = new Set((params.excludeMessageIds ?? []).filter(Boolean));

  const messages = await prisma.chatMessage.findMany({
    where: {
      sessionId: params.sessionId,
      session: {
        userId: params.userId,
      },
    },
    select: {
      id: true,
      role: true,
      content: true,
      mode: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  let budgetUsed = 0;
  const selected: ContextMessage[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (excludeMessageIds.has(message.id)) {
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    if (!message.content.trim()) {
      continue;
    }
    if (selected.length >= maxMessages) {
      break;
    }

    const cost = estimateMessageCost(message.content);
    if (selected.length > 0 && budgetUsed + cost > maxWindowChars) {
      break;
    }

    budgetUsed += cost;
    selected.push({
      id: message.id,
      role: message.role,
      content: message.content,
      mode: message.mode,
      createdAt: message.createdAt.toISOString(),
    });
  }

  return selected.reverse();
}
