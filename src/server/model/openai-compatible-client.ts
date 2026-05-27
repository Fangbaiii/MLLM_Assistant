import { readFile } from "node:fs/promises";
import { resolveModelForMode } from "@/lib/model-routing";
import { getTrimmedConversationContext, type ContextMessage } from "@/server/chat/chat-service";
import { loadAttachmentContext, type StoredUploadArtifact } from "@/server/upload/upload-artifact-service";
import type { ChatRequest, ChatResponse, EvidenceDocument, OcrBlock, EvidenceItem } from "@/types/app";

type OpenAITextPart = {
  type: "text";
  text: string;
};

type OpenAIImagePart = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<OpenAITextPart | OpenAIImagePart>;
};

type OpenAIChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
};

type OpenAIChunk = {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    message?: {
      content?: string | null;
    };
  }>;
};

type PreparedModelRequest = {
  model: string;
  messages: OpenAIMessage[];
  attachmentContext: {
    ocrBlocks: OcrBlock[];
    evidence: EvidenceItem[];
  };
};

export type ModelStreamCallbacks = {
  onToken: (token: string) => Promise<void> | void;
};

export type ModelStreamResult = {
  content: string;
  model: string;
  reasoning: string;
  ocrBlocks: OcrBlock[];
  evidence: EvidenceItem[];
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_MAX_TOKENS = 2048;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_REASONING_CHARS = 2_000;

function getModelBaseUrl() {
  return (process.env.MLLM_MODEL_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getModelName(mode: ChatRequest["mode"]) {
  return process.env.MLLM_MODEL_NAME?.trim() || resolveModelForMode(mode);
}

function getMaxTokens() {
  const value = Number(process.env.MLLM_MODEL_MAX_TOKENS);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_TOKENS;
  }

  return value;
}

function getTemperature(mode: ChatRequest["mode"]) {
  if (mode === "think") return 0.2;
  if (mode === "explain") return 0.4;
  return 0.3;
}

function getModelApiKey() {
  return process.env.MLLM_MODEL_API_KEY?.trim() || "";
}

function getProviderLabel(baseUrl: string) {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("api.openai.com")) return "openai";
  if (lower.includes("deepseek")) return "deepseek";
  return "openai-compatible";
}

function supportsImageInput(baseUrl: string) {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("api.deepseek.com")) {
    return false;
  }
  return true;
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[已截断]`;
}

function buildDocumentContext(documents: EvidenceDocument[]) {
  const sections = documents.flatMap((document) =>
    document.pages.map((page) => {
      const markdown = page.markdown.trim();
      const blockText = page.blocks
        .slice(0, 8)
        .map((block) => `${block.title}: ${block.content}`)
        .join("\n");

      return [
        `文件：${document.assetName}`,
        `路由：${document.routing}`,
        `页码：${page.pageNumber}`,
        markdown || blockText || document.summary,
      ].join("\n");
    }),
  );

  if (!sections.length) {
    return "";
  }

  return truncate(["以下是上传文件的 OCR/证据上下文：", ...sections].join("\n\n---\n\n"), MAX_CONTEXT_CHARS);
}

async function artifactToImagePart(artifact: StoredUploadArtifact): Promise<OpenAIImagePart | null> {
  if (!artifact.type.startsWith("image/")) {
    return null;
  }

  const data = await readFile(artifact.filePath);
  return {
    type: "image_url",
    image_url: {
      url: `data:${artifact.type};base64,${data.toString("base64")}`,
    },
  };
}

function buildSystemMessage(systemPrompt: string | null): OpenAIMessage {
  return {
    role: "system",
    content:
      systemPrompt ||
      [
        "你是 MLLM Studio 的多模态助手。",
        "请使用中文回答，优先基于用户上传的图片、OCR 和证据上下文。",
        "如果证据不足，请明确说明不确定性，不要编造来源。",
      ].join("\n"),
  };
}

function toHistoryMessage(message: ContextMessage): OpenAIMessage {
  return {
    role: message.role,
    content: message.content,
  };
}

async function prepareModelRequest(params: {
  request: ChatRequest;
  userId: string;
  systemPrompt: string | null;
  excludeMessageIds?: string[];
}): Promise<PreparedModelRequest> {
  const model = getModelName(params.request.mode);
  const baseUrl = getModelBaseUrl();
  const canSendImageParts = supportsImageInput(baseUrl);
  const attachmentContext = await loadAttachmentContext(params.request.attachmentIds);
  const history = await getTrimmedConversationContext({
    sessionId: params.request.sessionId,
    userId: params.userId,
    excludeMessageIds: params.excludeMessageIds,
  });

  const documentContext = buildDocumentContext(attachmentContext.documents);
  const imageArtifacts = attachmentContext.artifacts.filter((artifact) => artifact.type.startsWith("image/"));
  const userContent: Array<OpenAITextPart | OpenAIImagePart> = [
    {
      type: "text",
      text: [
        documentContext,
        !canSendImageParts && imageArtifacts.length
          ? `已接收图片附件：${imageArtifacts.map((artifact) => artifact.name).join("、")}。当前上游模型接口不支持直接图像输入，将仅基于 OCR/证据文本回答。`
          : "",
        `用户问题：${params.request.message}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  if (canSendImageParts) {
    const imageParts = (
      await Promise.all(attachmentContext.artifacts.slice(0, MAX_IMAGE_ATTACHMENTS).map(artifactToImagePart))
    ).filter((part): part is OpenAIImagePart => part !== null);
    userContent.push(...imageParts);
  }

  const userMessage: OpenAIMessage = canSendImageParts
    ? { role: "user", content: userContent }
    : {
        role: "user",
        content: userContent
          .filter((part): part is OpenAITextPart => part.type === "text")
          .map((part) => part.text)
          .join("\n\n"),
      };

  const messages: OpenAIMessage[] = [
    buildSystemMessage(params.systemPrompt),
    ...history.map(toHistoryMessage),
    userMessage,
  ];

  return {
    model,
    messages,
    attachmentContext: {
      ocrBlocks: attachmentContext.ocrBlocks,
      evidence: attachmentContext.evidence,
    },
  };
}

function completionHeaders() {
  const apiKey = getModelApiKey();
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function requestNonStreamingCompletion(prepared: PreparedModelRequest, mode: ChatRequest["mode"]) {
  const response = await fetch(`${getModelBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: completionHeaders(),
    body: JSON.stringify({
      model: prepared.model,
      messages: prepared.messages,
      temperature: getTemperature(mode),
      max_tokens: getMaxTokens(),
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`模型服务调用失败（HTTP ${response.status}）：${errorText.slice(0, 500)}`);
  }

  const payload = (await response.json()) as OpenAIChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("模型服务没有返回可用回答。");
  }

  return {
    model: payload.model || prepared.model,
    content,
    reasoningContent: payload.choices?.[0]?.message?.reasoning_content || "",
  };
}

function splitSseBlocks(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  return {
    completed: blocks.slice(0, -1),
    pending: blocks[blocks.length - 1] ?? "",
  };
}

function parseSseDataBlock(block: string) {
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  return dataLines.join("\n");
}

function buildReasoningLabel(model: string, providerLabel: string, reasoningContent: string) {
  const summary = reasoningContent.trim();
  if (!summary) {
    return `${providerLabel} stream model: ${model}`;
  }
  return `${providerLabel} stream model: ${model}\n\n${truncate(summary, MAX_REASONING_CHARS)}`;
}

export async function streamModelChatResponse(
  params: {
    request: ChatRequest;
    userId: string;
    systemPrompt: string | null;
    excludeMessageIds?: string[];
  },
  callbacks: ModelStreamCallbacks,
): Promise<ModelStreamResult> {
  const prepared = await prepareModelRequest(params);
  const baseUrl = getModelBaseUrl();
  const providerLabel = getProviderLabel(baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: completionHeaders(),
    body: JSON.stringify({
      model: prepared.model,
      messages: prepared.messages,
      temperature: getTemperature(params.request.mode),
      max_tokens: getMaxTokens(),
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status >= 400 && response.status < 500) {
      const fallback = await requestNonStreamingCompletion(prepared, params.request.mode);
      await callbacks.onToken(fallback.content);
      return {
        content: fallback.content,
        model: fallback.model,
        reasoning: buildReasoningLabel(fallback.model, providerLabel, fallback.reasoningContent),
        ocrBlocks: prepared.attachmentContext.ocrBlocks,
        evidence: prepared.attachmentContext.evidence,
      };
    }
    throw new Error(`模型服务调用失败（HTTP ${response.status}）：${errorText.slice(0, 500)}`);
  }
  if (!response.body) {
    throw new Error("模型服务未返回可读取的流。");
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const fallback = (await response.json()) as OpenAIChatCompletionResponse;
    const content = fallback.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("模型服务没有返回可用回答。");
    }
    await callbacks.onToken(content);
    const responseModel = fallback.model || prepared.model;
    const reasoningContent = fallback.choices?.[0]?.message?.reasoning_content || "";
    return {
      content,
      model: responseModel,
      reasoning: buildReasoningLabel(responseModel, providerLabel, reasoningContent),
      ocrBlocks: prepared.attachmentContext.ocrBlocks,
      evidence: prepared.attachmentContext.evidence,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  let fullContent = "";
  let reasoningContent = "";
  let responseModel = prepared.model;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    pending += decoder.decode(value, { stream: true });
    const chunks = splitSseBlocks(pending);
    pending = chunks.pending;

    for (const block of chunks.completed) {
      const data = parseSseDataBlock(block);
      if (!data || data === "[DONE]") {
        continue;
      }

      let payload: OpenAIChunk;
      try {
        payload = JSON.parse(data) as OpenAIChunk;
      } catch {
        continue;
      }

      responseModel = payload.model || responseModel;
      const choice = payload.choices?.[0];
      const delta = choice?.delta;
      const contentToken = delta?.content ?? "";
      const reasoningToken = delta?.reasoning_content ?? "";

      if (typeof reasoningToken === "string" && reasoningToken) {
        reasoningContent += reasoningToken;
      }
      if (typeof contentToken === "string" && contentToken) {
        fullContent += contentToken;
        await callbacks.onToken(contentToken);
      }
    }
  }

  if (pending.trim()) {
    const data = parseSseDataBlock(pending);
    if (data && data !== "[DONE]") {
      try {
        const payload = JSON.parse(data) as OpenAIChunk;
        const choice = payload.choices?.[0];
        const delta = choice?.delta;
        const contentToken = delta?.content ?? "";
        const reasoningToken = delta?.reasoning_content ?? "";
        if (typeof reasoningToken === "string" && reasoningToken) {
          reasoningContent += reasoningToken;
        }
        if (typeof contentToken === "string" && contentToken) {
          fullContent += contentToken;
          await callbacks.onToken(contentToken);
        }
      } catch {
        // ignore trailing parse error
      }
    }
  }

  if (!fullContent.trim()) {
    throw new Error("模型服务没有返回可用回答。");
  }

  return {
    content: fullContent.trim(),
    model: responseModel,
    reasoning: buildReasoningLabel(responseModel, providerLabel, reasoningContent),
    ocrBlocks: prepared.attachmentContext.ocrBlocks,
    evidence: prepared.attachmentContext.evidence,
  };
}

export async function generateModelChatResponse(
  request: ChatRequest,
  systemPrompt: string | null,
  userId: string,
): Promise<ChatResponse> {
  const prepared = await prepareModelRequest({
    request,
    userId,
    systemPrompt,
  });

  const completion = await requestNonStreamingCompletion(prepared, request.mode);
  const model = completion.model;
  return {
    message: {
      id: "assistant-response",
      role: "assistant",
      createdAt: new Date().toISOString(),
      mode: request.mode,
      content: completion.content,
      evidence: prepared.attachmentContext.evidence,
      reasoning: buildReasoningLabel(model, getProviderLabel(getModelBaseUrl()), completion.reasoningContent),
    },
    ocrBlocks: prepared.attachmentContext.ocrBlocks,
    model,
  };
}
