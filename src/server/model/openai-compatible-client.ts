import { readFile } from "node:fs/promises";
import { resolveModelForRequest } from "@/lib/model-routing";
import { getTrimmedConversationContext, type ContextMessage } from "@/server/chat/chat-service";
import type { AttachmentContext, StoredUploadArtifact } from "@/server/upload/upload-artifact-service";
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
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
};

type OpenAIChunk = {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
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
  maxTokens: number;
  sampling: SamplingConfig;
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
  finishReason: string;
  ocrBlocks: OcrBlock[];
  evidence: EvidenceItem[];
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_MODEL_CONTEXT_TOKENS = 4096;
const DEFAULT_DOCUMENT_CONTEXT_CHARS = 12_000;
const DEFAULT_MIN_RESPONSE_TOKENS = 256;
const DEFAULT_PROMPT_SAFETY_TOKENS = 128;
const DEFAULT_ESTIMATED_TOKENS_PER_IMAGE = 1024;
const DEFAULT_MAX_IMAGE_ATTACHMENTS = 4;
const MAX_REASONING_CHARS = 2_000;

type SamplingConfig = {
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  frequencyPenalty: number;
  minTokens: number;
};

type ContextLimitError = {
  maxContextTokens: number;
  inputTokens: number;
  suggestedMaxTokens: number;
};

function getModelBaseUrl() {
  return (process.env.MLLM_MODEL_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function getModelName(request: ChatRequest) {
  return resolveModelForRequest({
    mode: request.mode,
    message: request.message,
    hasAttachments: request.attachmentIds.length > 0,
  });
}

function getMaxTokens(mode: ChatRequest["mode"]) {
  const modeKey = `MLLM_MODEL_MAX_TOKENS_${mode.toUpperCase()}`;
  const value = Number(process.env[modeKey] ?? process.env.MLLM_MODEL_MAX_TOKENS);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_TOKENS;
  }

  return value;
}

function getModelContextLimit() {
  return parsePositiveInt(
    process.env.MLLM_MAX_MODEL_LEN ?? process.env.MLLM_MODEL_CONTEXT_TOKENS,
    DEFAULT_MODEL_CONTEXT_TOKENS,
  );
}

function getMinResponseTokens() {
  return parsePositiveInt(process.env.MLLM_MODEL_MIN_TOKENS, DEFAULT_MIN_RESPONSE_TOKENS);
}

function getPromptSafetyTokens() {
  return parsePositiveInt(process.env.MLLM_MODEL_CONTEXT_SAFETY_TOKENS, DEFAULT_PROMPT_SAFETY_TOKENS);
}

function getEstimatedTokensPerImage() {
  return parsePositiveInt(process.env.MLLM_ESTIMATED_TOKENS_PER_IMAGE, DEFAULT_ESTIMATED_TOKENS_PER_IMAGE);
}

function getDocumentContextCharBudget() {
  return parsePositiveInt(process.env.MLLM_DOCUMENT_CONTEXT_CHARS, DEFAULT_DOCUMENT_CONTEXT_CHARS);
}

function getMaxImageAttachments() {
  return parsePositiveInt(process.env.MLLM_MAX_IMAGE_ATTACHMENTS, DEFAULT_MAX_IMAGE_ATTACHMENTS);
}

function getTemperature(mode: ChatRequest["mode"]) {
  if (mode === "think") return 0.2;
  if (mode === "explain") return 0.4;
  return 0.3;
}

function parseNumber(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function getSamplingConfig(mode: ChatRequest["mode"]): SamplingConfig {
  const suffix = mode.toUpperCase();
  const minTokensFallback = mode === "explain" ? 160 : mode === "think" ? 96 : 0;
  const repetitionPenaltyFallback = mode === "explain" ? 1.08 : 1.1;
  const frequencyPenaltyFallback = mode === "explain" ? 0.05 : 0.1;
  return {
    temperature: parseNumber(process.env[`MLLM_TEMPERATURE_${suffix}`], getTemperature(mode)),
    topP: parseNumber(process.env[`MLLM_TOP_P_${suffix}`] ?? process.env.MLLM_TOP_P, 0.8),
    topK: Math.floor(parseNumber(process.env[`MLLM_TOP_K_${suffix}`] ?? process.env.MLLM_TOP_K, 20)),
    repetitionPenalty: parseNumber(
      process.env[`MLLM_REPETITION_PENALTY_${suffix}`] ?? process.env.MLLM_REPETITION_PENALTY,
      repetitionPenaltyFallback,
    ),
    frequencyPenalty: parseNumber(
      process.env[`MLLM_FREQUENCY_PENALTY_${suffix}`] ?? process.env.MLLM_FREQUENCY_PENALTY,
      frequencyPenaltyFallback,
    ),
    minTokens: Math.max(
      0,
      Math.floor(
        parseNumber(process.env[`MLLM_MIN_TOKENS_${suffix}`], minTokensFallback),
      ),
    ),
  };
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

function supportsLocalSamplingExtensions(baseUrl: string) {
  return /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(baseUrl.toLowerCase());
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[已截断]`;
}

function buildDocumentContext(documents: EvidenceDocument[], maxLength: number) {
  if (maxLength <= 0) {
    return "";
  }

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

  return truncate(["以下是上传文件的 OCR/证据上下文：", ...sections].join("\n\n---\n\n"), maxLength);
}

function buildUserPromptText(params: {
  documentContext: string;
  imageNotice: string;
  question: string;
}) {
  return [
    `用户任务：${params.question}`,
    params.documentContext,
    params.imageNotice,
    "请直接完成用户任务：不要复述问题，不要大段照抄 OCR，不要重复已经表达过的句子；信息足够后自然结束。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function estimateTextTokens(value: string) {
  let cjkChars = 0;
  let latinChars = 0;
  let otherChars = 0;

  for (const char of value) {
    if (/\s/.test(char)) {
      continue;
    }

    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(char)) {
      cjkChars += 1;
      continue;
    }

    if (/[\x00-\x7f]/.test(char)) {
      latinChars += 1;
      continue;
    }

    otherChars += 1;
  }

  return Math.ceil(cjkChars + latinChars / 4 + otherChars * 0.75) + 8;
}

function estimateMessageTokens(message: OpenAIMessage) {
  if (typeof message.content === "string") {
    return estimateTextTokens(message.content) + 12;
  }

  let total = 12;
  for (const part of message.content) {
    if (part.type === "text") {
      total += estimateTextTokens(part.text);
      continue;
    }

    total += getEstimatedTokensPerImage();
  }

  return total;
}

function estimateConversationTokens(messages: OpenAIMessage[]) {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 24);
}

function parseContextLimitError(errorText: string): ContextLimitError | null {
  const match = errorText.match(
    /maximum context length is (\d+) tokens and your request has (\d+) input tokens/i,
  );

  if (!match) {
    return null;
  }

  const maxContextTokens = Number(match[1]);
  const inputTokens = Number(match[2]);
  if (!Number.isFinite(maxContextTokens) || !Number.isFinite(inputTokens)) {
    return null;
  }

  const suggestedMaxTokens = Math.max(64, maxContextTokens - inputTokens - getPromptSafetyTokens());
  return {
    maxContextTokens,
    inputTokens,
    suggestedMaxTokens,
  };
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

function buildSystemMessage(systemPrompt: string | null, mode: ChatRequest["mode"]): OpenAIMessage {
  const modeInstruction = {
    default: [
      "回答长度应自适应任务：简单事实可简短，解释、比较、分析、创作和追问应充分展开。",
      "需要展开时按“结论、依据、补充说明”组织，避免空泛复述和凑字数。",
      "面对长 OCR 或论文转录，先提炼与问题相关的信息，再作答；不要复述用户问题或连续照抄原文。",
    ],
    explain: [
      "采用详细讲解模式：先给结论，再解释依据、关键步骤和必要例子。",
      "保持信息密度，不重复同一观点。",
      "长文档只引用支持结论的关键片段，不逐段转录。",
    ],
    think: [
      "进行充分分析后给出清晰结论、依据、风险与权衡。",
      "不要输出隐藏思维链或逐字内部推理，只呈现可核验的分析摘要。",
      "先核对文档证据与历史约束，发现已有回答重复时主动压缩并纠正。",
    ],
  }[mode];
  return {
    role: "system",
    content:
      [
        systemPrompt || "你是 MLLM Studio 的多模态助手。",
        "请使用中文回答，优先基于用户上传的图片、OCR 和证据上下文。",
        "如果证据不足，请明确说明不确定性，不要编造来源。",
        ...modeInstruction,
      ].join("\n"),
  };
}

function toHistoryMessage(message: ContextMessage): OpenAIMessage {
  return {
    role: message.role,
    content: message.content,
  };
}

function createUserMessage(params: {
  canSendImageParts: boolean;
  imageParts: OpenAIImagePart[];
  text: string;
}): OpenAIMessage {
  if (params.canSendImageParts) {
    return {
      role: "user",
      content: [
        {
          type: "text",
          text: params.text,
        },
        ...params.imageParts,
      ],
    };
  }

  return {
    role: "user",
    content: params.text,
  };
}

function dropOldestHistoryRound(messages: ContextMessage[]) {
  if (!messages.length) {
    return;
  }
  if (messages[0].role === "system") {
    messages.shift();
    return;
  }
  messages.shift();
  while (messages[0]?.role === "assistant") {
    messages.shift();
  }
}

async function prepareModelRequest(params: {
  request: ChatRequest;
  userId: string;
  systemPrompt: string | null;
  attachmentContext: AttachmentContext;
  excludeMessageIds?: string[];
}): Promise<PreparedModelRequest> {
  const model = getModelName(params.request);
  const baseUrl = getModelBaseUrl();
  const canSendImageParts = supportsImageInput(baseUrl);
  const history = await getTrimmedConversationContext({
    sessionId: params.request.sessionId,
    userId: params.userId,
    excludeMessageIds: params.excludeMessageIds,
  });

  const documents = params.attachmentContext.documents;
  const imageArtifacts = params.attachmentContext.artifacts.filter((artifact) => artifact.type.startsWith("image/"));
  const imageNotice =
    !canSendImageParts && imageArtifacts.length
      ? `已接收图片附件：${imageArtifacts.map((artifact) => artifact.name).join("、")}。当前上游模型接口不支持直接图像输入，将仅基于 OCR/证据文本回答。`
      : "";
  const imageParts = canSendImageParts
    ? (
        await Promise.all(
          params.attachmentContext.artifacts.slice(0, getMaxImageAttachments()).map(artifactToImagePart),
        )
      ).filter((part): part is OpenAIImagePart => part !== null)
    : [];
  const systemMessage = buildSystemMessage(params.systemPrompt, params.request.mode);
  const preferredMaxTokens = getMaxTokens(params.request.mode);
  const sampling = getSamplingConfig(params.request.mode);
  const promptSafetyTokens = getPromptSafetyTokens();
  const minResponseTokens = getMinResponseTokens();
  const historyMessages = [...history];
  let documentContextCharBudget = getDocumentContextCharBudget();
  let documentContext = buildDocumentContext(documents, documentContextCharBudget);
  let userMessage = createUserMessage({
    canSendImageParts,
    imageParts,
    text: buildUserPromptText({
      documentContext,
      imageNotice,
      question: params.request.message,
    }),
  });
  let messages: OpenAIMessage[] = [systemMessage, ...historyMessages.map(toHistoryMessage), userMessage];

  const refreshMessages = () => {
    documentContext = buildDocumentContext(documents, documentContextCharBudget);
    userMessage = createUserMessage({
      canSendImageParts,
      imageParts,
      text: buildUserPromptText({
        documentContext,
        imageNotice,
        question: params.request.message,
      }),
    });
    messages = [systemMessage, ...historyMessages.map(toHistoryMessage), userMessage];
  };

  while (true) {
    const estimatedPromptTokens = estimateConversationTokens(messages);
    const availablePromptTokens = getModelContextLimit() - preferredMaxTokens - promptSafetyTokens;
    if (estimatedPromptTokens <= availablePromptTokens) {
      break;
    }

    if (historyMessages.length > 0) {
      dropOldestHistoryRound(historyMessages);
      messages = [systemMessage, ...historyMessages.map(toHistoryMessage), userMessage];
      continue;
    }

    if (documentContextCharBudget > 0) {
      const nextBudget = Math.floor(documentContextCharBudget * 0.6);
      documentContextCharBudget = nextBudget > 0 && nextBudget < documentContextCharBudget ? nextBudget : 0;
      refreshMessages();
      continue;
    }

    break;
  }

  const finalPromptTokens = estimateConversationTokens(messages);
  const maxTokens = Math.min(
    preferredMaxTokens,
    Math.max(64, getModelContextLimit() - finalPromptTokens - promptSafetyTokens),
  );

  return {
    model,
    messages,
    maxTokens: Math.max(Math.min(maxTokens, preferredMaxTokens), Math.min(minResponseTokens, preferredMaxTokens)),
    sampling,
    attachmentContext: {
      ocrBlocks: params.attachmentContext.ocrBlocks,
      evidence: params.attachmentContext.evidence,
    },
  };
}

function completionPayload(
  prepared: PreparedModelRequest,
  options: { stream: boolean; maxTokens?: number },
) {
  const baseUrl = getModelBaseUrl();
  const payload: Record<string, unknown> = {
    model: prepared.model,
    messages: prepared.messages,
    temperature: prepared.sampling.temperature,
    top_p: prepared.sampling.topP,
    frequency_penalty: prepared.sampling.frequencyPenalty,
    max_tokens: options.maxTokens ?? prepared.maxTokens,
    stream: options.stream,
  };
  if (supportsLocalSamplingExtensions(baseUrl)) {
    payload.top_k = prepared.sampling.topK;
    payload.repetition_penalty = prepared.sampling.repetitionPenalty;
    if (prepared.sampling.minTokens > 0) {
      payload.min_tokens = Math.min(prepared.sampling.minTokens, prepared.maxTokens);
    }
  }
  return payload;
}

function completionHeaders() {
  const apiKey = getModelApiKey();
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function requestNonStreamingCompletion(prepared: PreparedModelRequest, signal?: AbortSignal) {
  const requestMaxTokens = prepared.maxTokens;
  const response = await fetch(`${getModelBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: completionHeaders(),
    body: JSON.stringify(completionPayload(prepared, { stream: false, maxTokens: requestMaxTokens })),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const contextLimitError = parseContextLimitError(errorText);
    if (contextLimitError && contextLimitError.suggestedMaxTokens < requestMaxTokens) {
      const retryResponse = await fetch(`${getModelBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: completionHeaders(),
        body: JSON.stringify(
          completionPayload(prepared, {
            stream: false,
            maxTokens: contextLimitError.suggestedMaxTokens,
          }),
        ),
        signal,
      });

      if (!retryResponse.ok) {
        const retryErrorText = await retryResponse.text();
        throw new Error(`模型服务调用失败（HTTP ${retryResponse.status}）：${retryErrorText.slice(0, 500)}`);
      }

      const retryPayload = (await retryResponse.json()) as OpenAIChatCompletionResponse;
      const retryContent = retryPayload.choices?.[0]?.message?.content?.trim();
      if (!retryContent) {
        throw new Error("模型服务没有返回可用回答。");
      }

      return {
        model: retryPayload.model || prepared.model,
        content: retryContent,
        reasoningContent: retryPayload.choices?.[0]?.message?.reasoning_content || "",
        finishReason: retryPayload.choices?.[0]?.finish_reason || "unknown",
      };
    }
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
    finishReason: payload.choices?.[0]?.finish_reason || "unknown",
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
	    attachmentContext: AttachmentContext;
	    excludeMessageIds?: string[];
	    signal?: AbortSignal;
	  },
  callbacks: ModelStreamCallbacks,
): Promise<ModelStreamResult> {
  const prepared = await prepareModelRequest(params);
  const baseUrl = getModelBaseUrl();
  const providerLabel = getProviderLabel(baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: completionHeaders(),
    body: JSON.stringify(completionPayload(prepared, { stream: true })),
    signal: params.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const contextLimitError = parseContextLimitError(errorText);
    if (contextLimitError && contextLimitError.suggestedMaxTokens < prepared.maxTokens) {
      const fallback = await requestNonStreamingCompletion(
        {
          ...prepared,
          maxTokens: contextLimitError.suggestedMaxTokens,
        },
        params.signal,
      );
      await callbacks.onToken(fallback.content);
      return {
        content: fallback.content,
        model: fallback.model,
        reasoning: buildReasoningLabel(fallback.model, providerLabel, fallback.reasoningContent),
        finishReason: fallback.finishReason,
        ocrBlocks: prepared.attachmentContext.ocrBlocks,
        evidence: prepared.attachmentContext.evidence,
      };
    }
    if (response.status >= 400 && response.status < 500) {
      const fallback = await requestNonStreamingCompletion(prepared, params.signal);
      await callbacks.onToken(fallback.content);
      return {
        content: fallback.content,
        model: fallback.model,
        reasoning: buildReasoningLabel(fallback.model, providerLabel, fallback.reasoningContent),
        finishReason: fallback.finishReason,
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
      finishReason: fallback.choices?.[0]?.finish_reason || "unknown",
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
  let finishReason = "unknown";

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
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
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
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
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
    finishReason,
    ocrBlocks: prepared.attachmentContext.ocrBlocks,
    evidence: prepared.attachmentContext.evidence,
  };
}

export async function generateModelChatResponse(
  request: ChatRequest,
  systemPrompt: string | null,
  userId: string,
  attachmentContext: AttachmentContext,
): Promise<ChatResponse> {
  const prepared = await prepareModelRequest({
    request,
    userId,
    systemPrompt,
    attachmentContext,
  });

  const completion = await requestNonStreamingCompletion(prepared);
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
