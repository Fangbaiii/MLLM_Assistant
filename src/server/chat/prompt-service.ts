import { prisma } from "@/lib/prisma";

export async function getSystemPrompt(mode: string) {
  try {
    const prompt = await prisma.systemPrompt.findUnique({
      where: { mode },
    });
    return prompt?.content || null;
  } catch (error) {
    console.error(`[PromptService] Error fetching prompt for mode ${mode}:`, error);
    return null;
  }
}

export async function updateSystemPrompt(mode: string, content: string) {
  return prisma.systemPrompt.upsert({
    where: { mode },
    update: { content },
    create: { mode, content },
  });
}
