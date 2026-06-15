import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteStoredUploadArtifact, loadStoredUploadFile } from "@/server/upload/upload-artifact-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { assetId } = await params;
  const stored = await loadStoredUploadFile(assetId, session.user.id);
  if (!stored) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  return new Response(stored.data, {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(stored.artifact.name)}`,
      "Content-Length": String(stored.data.byteLength),
      "Content-Type": stored.artifact.type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { assetId } = await params;
  try {
    await deleteStoredUploadArtifact(assetId, session.user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除附件失败";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
