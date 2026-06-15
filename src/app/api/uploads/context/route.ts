import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStoredUploadUrl, loadAttachmentContext } from "@/server/upload/upload-artifact-service";

export const runtime = "nodejs";

function parseAssetIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => (typeof item === "string" ? [item] : []));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const attachmentContext = await loadAttachmentContext(parseAssetIds(body.assetIds), session.user.id);

  return NextResponse.json({
    assets: attachmentContext.artifacts.map((artifact) => ({
      id: artifact.assetId,
      name: artifact.name,
      type: artifact.type,
      size: artifact.size,
      previewUrl: getStoredUploadUrl(artifact.assetId),
      progress: 100,
      status: "complete",
      routing: artifact.routing,
    })),
    ocrBlocks: attachmentContext.ocrBlocks,
    documents: attachmentContext.documents,
  });
}
