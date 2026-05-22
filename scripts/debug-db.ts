import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

async function main() {
  console.log("--- 数据库现状检查 ---");
  
  const users = await prisma.user.findMany({
    include: { _count: { select: { sessions: true } } }
  });
  console.log(`用户总数: ${users.length}`);
  users.forEach(u => {
    console.log(`- [${u.id}] ${u.email} (${u.name}) | 会话数: ${u._count.sessions}`);
  });

  const sessions = await prisma.chatSession.findMany({
    include: { _count: { select: { messages: true } } }
  });
  console.log(`\n会话总数: ${sessions.length}`);
  sessions.forEach(s => {
    console.log(`- [${s.id}] 标题: ${s.title} | 所属用户ID: ${s.userId} | 消息数: ${s._count.messages}`);
  });

  const messages = await prisma.chatMessage.findMany();
  console.log(`\n消息总数: ${messages.length}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
