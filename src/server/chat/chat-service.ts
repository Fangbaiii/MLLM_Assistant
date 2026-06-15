import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { UploadedAsset } from "@/types/app";

export type ContextMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  mode?: string | null;
  createdAt: string;
};

const DEFAULT_CONTEXT_WINDOW_CHARS = 18_000;
const DEFAULT_CONTEXT_MAX_MESSAGES = 16;
const DEFAULT_CONTEXT_SUMMARY_CHARS = 1_200;
const DEFAULT_CONTEXT_ATTACHMENT_LIMIT = 4;

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

function repeatedNgramRatio(content: string, n = 4) {
  const compact = normalizeMessageContent(content).replace(/\s+/g, "");
  if (compact.length < n * 4) {
    return 0;
  }

  const counts = new Map<string, number>();
  let repeated = 0;
  const total = compact.length - n + 1;
  for (let index = 0; index < total; index += 1) {
    const gram = compact.slice(index, index + n);
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      repeated += 1;
    }
    counts.set(gram, count + 1);
  }
  return repeated / total;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractAttachmentIds(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") {
      return [];
    }
    return item.id;
  });
}

function sanitizeContextContent(message: ContextMessage) {
  const normalized = normalizeMessageContent(message.content);
  if (message.role !== "assistant" || repeatedNgramRatio(normalized) < 0.32) {
    return normalized;
  }

  return `${normalized.slice(0, 600)}
[该轮后续内容存在明显重复，已从上下文中压缩；请勿延续重复措辞。]`;
}

function summarizeOmittedRounds(rounds: ContextMessage[][], maxChars: number) {
  if (!rounds.length || maxChars <= 0) {
    return "";
  }

  const lines: string[] = ["早期对话摘要（按原对话抽取，可能省略细节）："];
  for (const round of rounds) {
    const line = round
      .map((message) => {
        const speaker = message.role === "user" ? "用户" : "助手";
        return `${speaker}：${normalizeMessageContent(message.content).slice(0, 180)}`;
      })
      .join("；");
    const candidate = [...lines, line].join("\n");
    if (candidate.length > maxChars) {
      break;
    }
    lines.push(line);
  }
  return lines.length > 1 ? lines.join("\n") : "";
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
        attachments: Array.isArray(m.attachments) ? (m.attachments as UploadedAsset[]) : undefined,
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

export async function getUserChatSession(sessionId: string, userId: string) {
  return prisma.chatSession.findFirst({
    where: {
      id: sessionId,
      userId,
    },
  });
}

export async function getOrCreateChatSession(userId: string, title: string, sessionId: string) {
  const existing = await prisma.chatSession.findUnique({
    where: { id: sessionId },
  });

  if (existing) {
    if (existing.userId !== userId) {
      throw new Error("会话不存在或无权访问。");
    }
    return existing;
  }

  return createChatSession(userId, title, sessionId);
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

export async function clearChatSessionMessages(sessionId: string, userId: string) {
  const session = await getUserChatSession(sessionId, userId);
  if (!session) {
    throw new Error("会话不存在或无权访问。");
  }

  await prisma.chatMessage.deleteMany({
    where: {
      sessionId,
      session: {
        userId,
      },
    },
  });

  return prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      title: "新的多模态会话",
      summary: "会话已清空，可以重新开始。",
      updatedAt: new Date(),
    },
    include: {
      messages: true,
    },
  });
}

export async function duplicateChatSession(sessionId: string, userId: string) {
  const source = await prisma.chatSession.findFirst({
    where: {
      id: sessionId,
      userId,
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!source) {
    throw new Error("会话不存在或无权访问。");
  }

  const duplicated = await prisma.chatSession.create({
    data: {
      userId,
      title: `${source.title} 副本`,
      model: source.model,
      pinned: false,
      summary: source.summary,
      messages: {
        create: source.messages.map((message) => ({
          role: message.role,
          content: message.content,
          mode: message.mode,
          reasoning: message.reasoning,
          attachments: message.attachments === null ? undefined : message.attachments,
        })),
      },
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return {
    id: duplicated.id,
    title: duplicated.title,
    model: duplicated.model,
    updatedAt: duplicated.updatedAt.toISOString(),
    pinned: duplicated.pinned,
    summary: duplicated.summary,
    messages: duplicated.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      mode: message.mode,
      reasoning: message.reasoning,
      attachments: Array.isArray(message.attachments) ? (message.attachments as UploadedAsset[]) : undefined,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

export async function saveChatMessage(sessionId: string, data: {
  userId: string;
  role: string;
  content: string;
  mode?: string;
  reasoning?: string;
  attachments?: UploadedAsset[];
}) {
  console.log(`[ChatService] Saving message to session: ${sessionId}, role: ${data.role}`);
  const session = await getUserChatSession(sessionId, data.userId);
  if (!session) {
    throw new Error("会话不存在或无权访问。");
  }

  return prisma.chatMessage.create({
    data: {
      sessionId,
      role: data.role,
      content: data.content,
      mode: data.mode,
      reasoning: data.reasoning,
      attachments: data.attachments?.length
        ? (data.attachments as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });
}

export async function getRecentAttachmentIds(params: {
  sessionId: string;
  userId: string;
  explicitAttachmentIds: string[];
}) {
  const explicitIds = Array.from(new Set(params.explicitAttachmentIds.map((id) => id.trim()).filter(Boolean)));
  if (explicitIds.length) {
    return explicitIds;
  }

  const maxAttachments = parsePositiveInt(
    process.env.MLLM_CONTEXT_ATTACHMENT_LIMIT,
    DEFAULT_CONTEXT_ATTACHMENT_LIMIT,
  );
  const messages = await prisma.chatMessage.findMany({
    where: {
      sessionId: params.sessionId,
      role: "user",
      attachments: {
        not: Prisma.JsonNull,
      },
      session: {
        userId: params.userId,
      },
    },
    select: {
      attachments: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 8,
  });

  const inherited: string[] = [];
  for (const message of messages) {
    for (const id of extractAttachmentIds(message.attachments)) {
      if (!inherited.includes(id)) {
        inherited.push(id);
      }
      if (inherited.length >= maxAttachments) {
        return inherited;
      }
    }
  }

  return inherited;
}

export async function getTrimmedConversationContext(params: {
  sessionId: string;
  userId: string;
  excludeMessageIds?: string[];
}): Promise<ContextMessage[]> {
  const maxWindowChars = parsePositiveInt(
    process.env.MLLM_CONTEXT_WINDOW_CHARS,
    DEFAULT_CONTEXT_WINDOW_CHARS,
  );
  const maxMessages = parsePositiveInt(
    process.env.MLLM_CONTEXT_MAX_MESSAGES,
    DEFAULT_CONTEXT_MAX_MESSAGES,
  );
  const maxSummaryChars = parsePositiveInt(
    process.env.MLLM_CONTEXT_SUMMARY_CHARS,
    DEFAULT_CONTEXT_SUMMARY_CHARS,
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

  const eligible: ContextMessage[] = [];
  for (const message of messages) {
    if (excludeMessageIds.has(message.id)) {
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    if (!message.content.trim()) {
      continue;
    }
    const contextMessage: ContextMessage = {
      id: message.id,
      role: message.role,
      content: message.content,
      mode: message.mode,
      createdAt: message.createdAt.toISOString(),
    };
    eligible.push({
      ...contextMessage,
      content: sanitizeContextContent(contextMessage),
    });
  }

  const rounds: ContextMessage[][] = [];
  let currentRound: ContextMessage[] = [];
  for (const message of eligible) {
    if (message.role === "user") {
      if (currentRound.length) {
        rounds.push(currentRound);
      }
      currentRound = [message];
      continue;
    }
    if (currentRound.length) {
      currentRound.push(message);
    }
  }
  if (currentRound.length) {
    rounds.push(currentRound);
  }

  let budgetUsed = 0;
  let messageCount = 0;
  const selectedRounds: ContextMessage[][] = [];
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    const roundCost = round.reduce((sum, message) => sum + estimateMessageCost(message.content), 0);
    if (
      selectedRounds.length > 0
      && (messageCount + round.length > maxMessages || budgetUsed + roundCost > maxWindowChars)
    ) {
      break;
    }
    selectedRounds.unshift(round);
    messageCount += round.length;
    budgetUsed += roundCost;
  }

  const omittedCount = rounds.length - selectedRounds.length;
  const selected = selectedRounds.flat();
  if (omittedCount <= 0) {
    return selected;
  }

  const summaryBudget = Math.min(maxSummaryChars, Math.max(0, maxWindowChars - budgetUsed));
  const summary = summarizeOmittedRounds(rounds.slice(0, omittedCount), summaryBudget);
  if (!summary) {
    return selected;
  }
  const summaryMessage: ContextMessage = {
    id: "context-summary",
    role: "system",
    content: summary,
    mode: null,
    createdAt: selected[0]?.createdAt ?? new Date(0).toISOString(),
  };
  return [summaryMessage, ...selected];
}
