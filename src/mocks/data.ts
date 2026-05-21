import type { ChatSession, EvidenceItem, OcrBlock } from "@/types/app";
import { resolveModelForMode } from "@/lib/model-routing";

export const modelOptions = [
  "Qwen3-VL-8B-Instruct",
  "Qwen2.5-VL-7B-Instruct",
  "GLM-4.6V-Flash",
  "LLaMA-3.2-Vision",
];

export const fixedNow = "2026-05-17T09:00:00.000Z";

export const defaultEvidence: EvidenceItem[] = [
  { id: "ev-input", label: "截图 1", kind: "image", score: 0.94 },
  { id: "ev-ocr", label: "OCR 片段", kind: "ocr", score: 0.88 },
  { id: "ev-vlm", label: "VLM 判断", kind: "vlm", score: 0.91 },
];

export const mockOcrBlocks: OcrBlock[] = [
  {
    id: "ocr-route",
    page: "截图 1",
    text: "系统采用输入路由、证据组织、模型推理、工具增强与答案生成的分层结构，前端保留可替换接口。",
    confidence: 0.96,
  },
  {
    id: "ocr-doc",
    page: "截图 2",
    text: "多页 PDF 或 PPT 会先转为页面图像，再将候选页图像与 OCR 文本证据联合送入视觉语言模型。",
    confidence: 0.91,
  },
  {
    id: "ocr-mode",
    page: "截图 3",
    text: "默认模式追求简洁速度，/explain 强调结构化讲解，/think 允许更高的检索和推理预算。",
    confidence: 0.89,
  },
];

export const initialSessions: ChatSession[] = [
  {
    id: "session-architecture",
    title: "多模态系统架构分析",
    model: resolveModelForMode("default"),
    updatedAt: "2026-05-17T08:46:00.000Z",
    pinned: true,
    summary: "输入路由、证据组织和 VLM 推理链路的演示会话。",
    messages: [
      {
        id: "msg-welcome",
        role: "assistant",
        createdAt: "2026-05-17T08:46:00.000Z",
        mode: "default",
        content:
          "你好，我是 MLLM Studio。上传图片、文档截图或 PPT 页面后，可以直接用中文追问。我会在回答旁展示 OCR、证据页和推理过程。",
        evidence: defaultEvidence,
        reasoning: "系统会按输入类型组织证据，并在右侧同步展示 OCR 与页面级线索。",
      },
    ],
  },
  {
    id: "session-ocr",
    title: "讲义截图 OCR 问答",
    model: resolveModelForMode("think"),
    updatedAt: "2026-05-17T08:18:00.000Z",
    pinned: false,
    summary: "用于演示文档截图、OCR 片段和页面级证据。",
    messages: [],
  },
  {
    id: "session-vision",
    title: "商品图视觉理解",
    model: resolveModelForMode("default"),
    updatedAt: "2026-05-17T02:00:00.000Z",
    pinned: false,
    summary: "自然图像问答与视觉描述会话。",
    messages: [],
  },
];

export const sampleMarkdownAnswer = `我会按 **输入感知路由** 处理这类材料，而不是把所有图片都强行 OCR。

| 输入类型 | 前端展示 | 后续真实能力 |
| --- | --- | --- |
| 自然图片 | 图片预览 + VLM 回答 | 直接送入视觉语言模型 |
| 文档截图 | OCR 面板 + 证据引用 | OCR 文本与整页图联合推理 |
| 多页文档 | Top-k 证据页 | 页面级检索后再送入模型 |

对于你上传的文档截图，系统会优先保留视觉证据，再补充 OCR 文本。这样可以避免只看文字时丢失版面、公式、箭头关系和图表趋势。

\`\`\`ts
await apiClient.post("/chat", {
  sessionId,
  message,
  mode: "explain",
  attachmentIds,
});
\`\`\`

数学公式也可以渲染，例如页面级混合召回分数：$s = 0.6s_{bm25} + 0.4s_{dense}$。`;
