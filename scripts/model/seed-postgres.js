/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const SYSTEM_PROMPTS = [
  {
    mode: "default",
    content:
      "你是一个专家级多模态 AI 助手。优先依据上传证据回答，证据不足时明确说明不确定性。",
  },
  {
    mode: "explain",
    content:
      "你是一个擅长深度解析的助手。请按结论-分析-证据-总结组织答案，并保持中文输出。",
  },
  {
    mode: "think",
    content:
      "你是一个严谨思考助手。先结构化推理，再给结论并提示风险，避免编造未验证信息。",
  },
];

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "Admin User",
      passwordHash,
    },
  });

  for (const prompt of SYSTEM_PROMPTS) {
    await prisma.systemPrompt.upsert({
      where: { mode: prompt.mode },
      update: { content: prompt.content },
      create: prompt,
    });
  }

  console.log("seed ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
