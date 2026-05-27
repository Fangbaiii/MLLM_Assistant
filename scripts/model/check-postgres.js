/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.count();
  const prompts = await prisma.systemPrompt.count();
  const sessions = await prisma.chatSession.count();
  const messages = await prisma.chatMessage.count();
  console.log(JSON.stringify({ users, prompts, sessions, messages }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
