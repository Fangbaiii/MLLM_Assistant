import { prisma } from "@/lib/prisma";

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
