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
