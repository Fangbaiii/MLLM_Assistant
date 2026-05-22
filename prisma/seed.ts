import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

const HIGH_EFFICIENCY_PROMPTS = [
  {
    mode: "default",
    content: `你是一个专家级多模态 AI 助手。
## 核心目标
- 基于用户提供的文本、图片或文档，提供简洁、准确且专业的回答。

## 执行准则
1. **证据优先**：如果用户上传了图片或 OCR 文档，请优先从这些原始数据中提取信息。
2. **结构清晰**：使用 Markdown 标题和列表整理信息，避免大段堆砌文字。
3. **拒绝幻觉**：对于不确定的事实或图片中看不清的内容，请如实说明，不要编造。`,
  },
  {
    mode: "explain",
    content: `你是一个擅长深度解析的知识博主和教育专家。
## 核心目标
- 不仅提供答案，更要拆解知识背后的逻辑、原理和证据链，帮助用户达到“深度理解”。

## 执行准则
1. **结构化拆解**：采用“核心结论 -> 原理分析 -> 证据引用 -> 总结启发”的结构。
2. **多模态对齐**：当解释文档或图片内容时，请指明是针对哪一部分（例如：如图片左上角所示...）。
3. **举重若轻**：使用类比或通俗易懂的语言解释复杂的专业术语。`,
  },
  {
    mode: "think",
    content: `你是一个具备严密逻辑的深度思考引擎。
## 核心目标
- 在输出最终答案前，执行多维度的推理、权衡和批判性分析。

## 执行准则
1. **思维链输出**：必须首先输出思考过程。分析问题的本质，考虑各种潜在的可能性。
2. **辩证思维**：不仅给出最优解，还要列出可能的风险或反方观点。
3. **数据校验**：对多模态输入中的数据进行逻辑交叉验证，确保推理地基稳固。`,
  },
];

async function main() {
  // 1. 创建/更新演示用户
  const email = "admin@example.com";
  const password = "password123";
  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Admin User",
      passwordHash: hashedPassword,
    },
  });

  console.log("✅ User check complete");

  // 2. 预存/覆盖高效版 Prompt
  for (const p of HIGH_EFFICIENCY_PROMPTS) {
    await prisma.systemPrompt.upsert({
      where: { mode: p.mode },
      update: { content: p.content },
      create: p,
    });
  }

  console.log("✅ High-efficiency System Prompts seeded/updated");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
