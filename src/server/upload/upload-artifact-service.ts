import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvidenceDocument, EvidenceItem, OcrBlock } from "@/types/app";

export type StoredUploadArtifact = {
  assetId: string;
  name: string;
  type: string;
  size: number;
  routing: "ocr" | "vision";
  filePath: string;
  documentPath: string;
  createdAt: string;
};

export type AttachmentContext = {
  artifacts: StoredUploadArtifact[];
  documents: EvidenceDocument[];
  ocrBlocks: OcrBlock[];
  evidence: EvidenceItem[];
};

const DEFAULT_STORAGE_ROOT = "/mnt/data/tianyi/MLLM_Assistant/uploads";

function getStorageRoot() {
  return process.env.MLLM_STORAGE_DIR?.trim() || DEFAULT_STORAGE_ROOT;
}

function safePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

function metadataPath(assetId: string) {
  return path.join(getStorageRoot(), "metadata", `${safePathSegment(assetId)}.json`);
}

function documentPath(assetId: string) {
  return path.join(getStorageRoot(), "documents", `${safePathSegment(assetId)}.json`);
}

function filePath(assetId: string, fileName: string) {
  return path.join(getStorageRoot(), "files", `${safePathSegment(assetId)}-${safePathSegment(fileName)}`);
}

async function ensureStorageDirs() {
  await Promise.all([
    mkdir(path.join(getStorageRoot(), "files"), { recursive: true }),
    mkdir(path.join(getStorageRoot(), "metadata"), { recursive: true }),
    mkdir(path.join(getStorageRoot(), "documents"), { recursive: true }),
  ]);
}

export async function persistUploadArtifact(
  file: File,
  assetId: string,
  routing: "ocr" | "vision",
  document: EvidenceDocument,
) {
  await ensureStorageDirs();

  const storedFilePath = filePath(assetId, file.name);
  const storedDocumentPath = documentPath(assetId);
  const artifact: StoredUploadArtifact = {
    assetId,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    routing,
    filePath: storedFilePath,
    documentPath: storedDocumentPath,
    createdAt: new Date().toISOString(),
  };

  await Promise.all([
    writeFile(storedFilePath, Buffer.from(await file.arrayBuffer())),
    writeFile(storedDocumentPath, JSON.stringify(document, null, 2), "utf8"),
    writeFile(metadataPath(assetId), JSON.stringify(artifact, null, 2), "utf8"),
  ]);

  return artifact;
}

async function readJsonFile<T>(fileName: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(fileName, "utf8")) as T;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function documentToOcrBlocks(document: EvidenceDocument): OcrBlock[] {
  if (document.routing !== "ocr") {
    return [];
  }

  return document.pages
    .filter((page) => page.markdown.trim())
    .map((page) => ({
      id: `${document.assetId}-ocr-page-${page.pageNumber}`,
      page: `${document.assetName} - 第 ${page.pageNumber} 页`,
      text: page.markdown,
      confidence: page.confidence,
    }));
}

function documentToEvidence(document: EvidenceDocument): EvidenceItem[] {
  return document.pages.slice(0, 6).map((page) => ({
    id: page.id,
    label: `${document.assetName} / 第 ${page.pageNumber} 页`,
    kind: document.routing === "ocr" ? "ocr" : "vlm",
    score: document.averageConfidence || undefined,
  }));
}

export async function loadAttachmentContext(assetIds: string[]): Promise<AttachmentContext> {
  const uniqueAssetIds = Array.from(new Set(assetIds.map((id) => id.trim()).filter(Boolean)));
  const artifacts: StoredUploadArtifact[] = [];
  const documents: EvidenceDocument[] = [];

  for (const assetId of uniqueAssetIds) {
    const artifact = await readJsonFile<StoredUploadArtifact>(metadataPath(assetId));
    if (!artifact) {
      continue;
    }

    const document = await readJsonFile<EvidenceDocument>(artifact.documentPath);
    artifacts.push(artifact);
    if (document) {
      documents.push(document);
    }
  }

  return {
    artifacts,
    documents,
    ocrBlocks: documents.flatMap(documentToOcrBlocks),
    evidence: documents.flatMap(documentToEvidence),
  };
}
