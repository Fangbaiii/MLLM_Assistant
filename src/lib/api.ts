import axios from "axios";
import type { ChatRequest, ChatResponse, UploadResponse } from "@/types/app";

export const apiClient = axios.create({
  baseURL: "/api",
  timeout: 20_000,
});

export async function fetchHistory() {
  const response = await apiClient.get("/history");
  return response.data;
}

export async function updateHistorySession(id: string, patch: { title?: string; pinned?: boolean }) {
  const response = await apiClient.patch(`/history/${id}`, patch);
  return response.data;
}

export async function deleteHistorySession(id: string) {
  const response = await apiClient.delete(`/history/${id}`);
  return response.data;
}

export async function uploadFiles(
  files: Array<{
    assetId: string;
    file: File;
  }>,
): Promise<UploadResponse> {
  const formData = new FormData();
  files.forEach(({ assetId, file }) => {
    formData.append("files", file);
    formData.append("assetIds", assetId);
  });
  const response = await apiClient.post<UploadResponse>("/upload", formData);
  return response.data;
}

export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  const response = await apiClient.post<ChatResponse>("/chat", request);
  return response.data;
}

type StreamMetaPayload = {
  model?: string;
  mode?: ChatRequest["mode"];
  reasoning?: string;
  evidence?: ChatResponse["message"]["evidence"];
  ocrBlocks?: ChatResponse["ocrBlocks"];
};

type StreamCallbacks = {
  onToken: (token: string) => void;
  onMeta: (meta: StreamMetaPayload) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

function parseSseBlock(block: string) {
  const lines = block.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) return null;
  return { event, data: dataLines.join("\n") };
}

export async function streamChat(request: ChatRequest, callbacks: StreamCallbacks) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`请求失败（HTTP ${response.status}）`);
  }
  if (!response.body) {
    throw new Error("服务端未返回流。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let pending = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const blocks = pending.split("\n\n");
    pending = blocks.pop() ?? "";

    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      if (!parsed) continue;

      let payload: unknown;
      try {
        payload = JSON.parse(parsed.data);
      } catch {
        continue;
      }

      if (parsed.event === "delta") {
        const token = (payload as { text?: unknown }).text;
        if (typeof token === "string" && token) {
          callbacks.onToken(token);
        }
        continue;
      }

      if (parsed.event === "meta") {
        callbacks.onMeta(payload as StreamMetaPayload);
        continue;
      }

      if (parsed.event === "error") {
        const message = (payload as { message?: unknown }).message;
        callbacks.onError(typeof message === "string" ? message : "模型服务暂时不可用，请稍后重试。");
        return;
      }

      if (parsed.event === "done") {
        callbacks.onDone();
        return;
      }
    }
  }

  callbacks.onDone();
}
