import { NextResponse } from "next/server";
import { processUploadedFiles } from "@/server/upload/upload-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);
  const assetIds = formData.getAll("assetIds").map((item) => String(item));

  if (!files.length) {
    return NextResponse.json({ error: "请至少上传一个 PDF 或图片文件。" }, { status: 400 });
  }

  try {
    const result = await processUploadedFiles(files, assetIds);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "文档解析失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
