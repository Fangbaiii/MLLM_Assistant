import type { PaddleApiResponse, PaddleLayoutResult } from "@/server/upload/types";

const DEFAULT_TIMEOUT_SECONDS = 600;
const LAYOUT_PARSING_PATH = "/layout-parsing";
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp", ".gif"];

function getRequiredEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function resolveApiUrl(raw: string) {
  if (!raw) {
    throw new Error("缺少环境变量 PADDLEOCR_DOC_PARSING_API_URL。");
  }

  if (raw.startsWith("http://")) {
    throw new Error("PADDLEOCR_DOC_PARSING_API_URL 必须使用 https://");
  }

  const url = raw.startsWith("https://") ? raw : `https://${raw}`;
  if (!url.endsWith(LAYOUT_PARSING_PATH)) {
    throw new Error("PADDLEOCR_DOC_PARSING_API_URL 必须是完整接口地址，并以 /layout-parsing 结尾。");
  }

  return url;
}

function getTimeoutMs() {
  const raw = process.env.PADDLEOCR_DOC_PARSING_TIMEOUT?.trim();
  if (!raw) {
    return DEFAULT_TIMEOUT_SECONDS * 1000;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_SECONDS * 1000;
  }

  return value * 1000;
}

function detectFileType(file: File) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return 0;
  }

  if (IMAGE_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)) || file.type.startsWith("image/")) {
    return 1;
  }

  throw new Error(`暂不支持的文件类型：${file.name}`);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

export function getFileType(file: File) {
  return detectFileType(file);
}

export async function callPaddleDocumentParsingApi(file: File): Promise<PaddleLayoutResult[]> {
  const apiUrl = resolveApiUrl(getRequiredEnv("PADDLEOCR_DOC_PARSING_API_URL"));
  const token = getRequiredEnv("PADDLEOCR_ACCESS_TOKEN");

  if (!token) {
    throw new Error("缺少环境变量 PADDLEOCR_ACCESS_TOKEN。");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      "Client-Platform": "mllm-studio",
    },
    body: JSON.stringify({
      file: arrayBufferToBase64(await file.arrayBuffer()),
      fileType: detectFileType(file),
      visualize: false,
      useDocUnwarping: false,
      useDocOrientationClassify: false,
      useChartRecognition: false,
    }),
    signal: AbortSignal.timeout(getTimeoutMs()),
  });

  let payload: PaddleApiResponse | null = null;
  try {
    payload = (await response.json()) as PaddleApiResponse;
  } catch {
    throw new Error("PaddleOCR 返回了无法解析的响应。");
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(`PaddleOCR 鉴权失败：${payload?.errorMsg ?? "请检查 Access Token。"}`);
    }

    if (response.status === 429) {
      throw new Error(`PaddleOCR 触发限流：${payload?.errorMsg ?? "请稍后重试。"}`);
    }

    throw new Error(payload?.errorMsg || `PaddleOCR 接口调用失败（HTTP ${response.status}）。`);
  }

  if ((payload?.errorCode ?? 0) !== 0) {
    throw new Error(payload?.errorMsg || "PaddleOCR 返回了业务错误。");
  }

  const pages = payload?.result?.layoutParsingResults;
  if (!Array.isArray(pages)) {
    throw new Error("PaddleOCR 返回结构异常：缺少 layoutParsingResults。");
  }

  return pages;
}
