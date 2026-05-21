export type ChatRole = "user" | "assistant" | "system";

export type ChatMode = "default" | "explain" | "think";

export type DemoPreference = "balanced" | "quiet";

export type UploadedAsset = {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl: string;
  progress: number;
  status: "queued" | "uploading" | "complete" | "error";
  error?: string;
  routing?: "ocr" | "vision";
};

export type OcrBlock = {
  id: string;
  page: string;
  text: string;
  confidence: number;
};

export type EvidenceBlockKind =
  | "title"
  | "text"
  | "table"
  | "formula"
  | "figure"
  | "header"
  | "footer"
  | "other";

export type EvidenceBlock = {
  id: string;
  kind: EvidenceBlockKind;
  title: string;
  content: string;
  confidence: number;
  bbox?: [number, number, number, number];
};

export type EvidencePage = {
  id: string;
  pageNumber: number;
  title: string;
  markdown: string;
  confidence: number;
  width?: number;
  height?: number;
  blocks: EvidenceBlock[];
};

export type EvidenceDocument = {
  id: string;
  assetId: string;
  assetName: string;
  assetType: string;
  routing: "ocr" | "vision";
  summary: string;
  pageCount: number;
  averageConfidence: number;
  pages: EvidencePage[];
};

export type UploadResultFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  page: string;
  routing: "ocr" | "vision";
};

export type EvidenceItem = {
  id: string;
  label: string;
  kind: "image" | "ocr" | "vlm" | "retrieval";
  score?: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  mode?: ChatMode;
  attachments?: UploadedAsset[];
  evidence?: EvidenceItem[];
  reasoning?: string;
  isStreaming?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
  pinned?: boolean;
  summary?: string;
  messages: ChatMessage[];
};

export type ChatRequest = {
  sessionId: string;
  message: string;
  mode: ChatMode;
  attachmentIds: string[];
};

export type ChatResponse = {
  message: ChatMessage;
  ocrBlocks: OcrBlock[];
  model?: string;
};

export type UploadResponse = {
  ok: boolean;
  files: UploadResultFile[];
  ocrBlocks: OcrBlock[];
  documents: EvidenceDocument[];
};
