import { stripLeadingCommand } from "@/lib/chat-commands";
import { defaultEvidence } from "@/mocks/data";
import type { ChatMode, ChatRequest, ChatResponse } from "@/types/app";

function inferTopic(message: string) {
  if (/路由|流程|架构|pipeline|system/i.test(message)) return "系统架构";
  if (/上传|图片|截图|预览|attachment/i.test(message)) return "上传与证据";
  if (/markdown|latex|公式|代码|stream|token/i.test(message)) return "回答渲染";
  if (/会话|历史|sidebar|history/i.test(message)) return "会话管理";
  return "多模态问答";
}

function modeLeadIn(mode: ChatMode) {
  if (mode === "think") return "我会先整理证据，再给出结论。";
  if (mode === "explain") return "我用讲解模式回答：先结论，再结构。";
  return "先给你一个能直接落地的判断。";
}

function buildMathSection() {
  return [
    "### LaTeX 示例",
    "页面级检索可以写成 $s = 0.6 s_{bm25} + 0.4 s_{dense}$。",
    "",
    "$$",
    "P(page_i \\mid q) \\propto \\alpha \\cdot \\mathrm{BM25}(q, page_i) + (1 - \\alpha) \\cdot \\cos(e_q, e_i)",
    "$$",
  ].join("\n");
}

function buildBody(topic: string, question: string, attachmentCount: number, mode: ChatMode) {
  const normalizedQuestion = question || "当前只输入了模式命令，我先按演示场景回答。";

  const base = [
    "### 结论",
    `这更像一个关于 **${topic}** 的问题。`,
    "",
    "### 当前上下文",
    `- 你的问题：${normalizedQuestion}`,
    `- 附件数量：${attachmentCount} 个`,
    "- 证据来源：图片预览、OCR 段落、页面级召回",
    "",
    buildMathSection(),
    "",
  ];

  if (mode === "think") {
    base.push(
      "### 分析顺序",
      "1. 先确认输入类型。",
      "2. 再检查可引用的证据。",
      "3. 最后组织成产品级回答。",
    );
  }

  base.push(
    "### 代码示例",
    "```ts",
    "const response = await apiClient.post('/chat', { sessionId, message, mode, attachmentIds });",
    "```",
    "",
    "如果你继续追问，我会沿着同一条会话补充证据页、OCR 片段和推理路径。",
  );

  return base.join("\n");
}

export function buildMockChatResponse(request: ChatRequest): ChatResponse {
  const question = stripLeadingCommand(request.message);
  const topic = inferTopic(question);
  const attachmentCount = request.attachmentIds.length;
  const leadIn = modeLeadIn(request.mode);
  const body = buildBody(topic, question, attachmentCount, request.mode);

  return {
    message: {
      id: "assistant-response",
      role: "assistant",
      createdAt: "2026-05-17T09:00:00.000Z",
      mode: request.mode,
      content: [leadIn, "", body, "", "证据页：截图 1、OCR 片段、VLM 判断。"].join("\n"),
      evidence: defaultEvidence,
      reasoning: "Mock pipeline：输入分类 -> OCR/视觉路由 -> 证据组装 -> 流式输出。",
    },
    ocrBlocks: [],
  };
}
