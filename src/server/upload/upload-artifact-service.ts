import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { EvidenceDocument, EvidenceItem, OcrBlock } from "@/types/app";

export type StoredUploadArtifact = {
  assetId: string;
  ownerId?: string;
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

export function getStoredUploadUrl(assetId: string) {
  return `/api/uploads/${encodeURIComponent(assetId)}`;
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
  ownerId: string,
  routing: "ocr" | "vision",
  document: EvidenceDocument,
) {
  await ensureStorageDirs();

  const existing = await readJsonFile<StoredUploadArtifact>(metadataPath(assetId));
  if (existing && existing.ownerId && existing.ownerId !== ownerId) {
    throw new Error("上传文件 ID 已存在，请重新选择文件后再试。");
  }

  const storedFilePath = filePath(assetId, file.name);
  const storedDocumentPath = documentPath(assetId);
  const artifact: StoredUploadArtifact = {
    assetId,
    ownerId,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractAttachmentIds(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") {
      return [];
    }
    return item.id;
  });
}

async function userHasLegacyAttachmentReference(assetId: string, userId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: {
      attachments: {
        not: Prisma.JsonNull,
      },
      session: {
        userId,
      },
    },
    select: {
      attachments: true,
    },
  });

  return messages.some((message) => extractAttachmentIds(message.attachments).includes(assetId));
}

async function userHasAttachmentReference(assetId: string, userId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: {
      attachments: {
        not: Prisma.JsonNull,
      },
      session: {
        userId,
      },
    },
    select: {
      attachments: true,
    },
  });

  return messages.some((message) => extractAttachmentIds(message.attachments).includes(assetId));
}

async function ensureArtifactAccess(artifact: StoredUploadArtifact, userId: string) {
  if (artifact.ownerId === userId) {
    return artifact;
  }

  if (!artifact.ownerId && await userHasLegacyAttachmentReference(artifact.assetId, userId)) {
    const claimed = { ...artifact, ownerId: userId };
    await writeFile(metadataPath(artifact.assetId), JSON.stringify(claimed, null, 2), "utf8");
    return claimed;
  }

  throw new Error("附件不存在或无权访问。");
}

export async function loadStoredUploadFile(assetId: string, userId: string) {
  const artifact = await readJsonFile<StoredUploadArtifact>(metadataPath(assetId));
  if (!artifact) {
    return null;
  }
  const authorizedArtifact = await ensureArtifactAccess(artifact, userId);

  return {
    artifact: authorizedArtifact,
    data: await readFile(authorizedArtifact.filePath),
  };
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

export async function loadAttachmentContext(assetIds: string[], userId: string): Promise<AttachmentContext> {
  const uniqueAssetIds = Array.from(new Set(assetIds.map((id) => id.trim()).filter(Boolean)));
  const artifacts: StoredUploadArtifact[] = [];
  const documents: EvidenceDocument[] = [];

  for (const assetId of uniqueAssetIds) {
    const artifact = await readJsonFile<StoredUploadArtifact>(metadataPath(assetId));
    if (!artifact) {
      continue;
    }
    const authorizedArtifact = await ensureArtifactAccess(artifact, userId);

    const document = await readJsonFile<EvidenceDocument>(authorizedArtifact.documentPath);
    artifacts.push(authorizedArtifact);
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

export async function deleteStoredUploadArtifact(assetId: string, userId: string) {
  const artifact = await readJsonFile<StoredUploadArtifact>(metadataPath(assetId));
  if (!artifact) {
    return false;
  }
  const authorizedArtifact = await ensureArtifactAccess(artifact, userId);
  if (await userHasAttachmentReference(assetId, userId)) {
    return false;
  }

  await Promise.all([
    rm(authorizedArtifact.filePath, { force: true }),
    rm(authorizedArtifact.documentPath, { force: true }),
    rm(metadataPath(assetId), { force: true }),
  ]);

  return true;
}
