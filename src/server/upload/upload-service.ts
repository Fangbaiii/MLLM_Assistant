import { callPaddleDocumentParsingApi, getFileType } from "@/server/upload/paddle-client";
import type { PaddleLayoutResult } from "@/server/upload/types";
import type {
  EvidenceBlock,
  EvidenceBlockKind,
  EvidenceDocument,
  EvidencePage,
  OcrBlock,
  UploadResultFile,
} from "@/types/app";

const OCR_HINT_PATTERN =
  /(doc|scan|page|screen|slide|ppt|pdf|invoice|report|note|paper|screenshot|capture|snip|home|chat|desktop|ui|dashboard|form|sheet|system|design|wechat|qq|feishu|dingtalk|notion|figma)/;
const VISION_HINT_PATTERN =
  /(photo|camera|landscape|scenery|vacation|travel|portrait|selfie|nature|mountain|beach|sunset|pet|food)/;

function stableUploadId(name: string, index: number) {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `upload-${index + 1}-${safeName || "file"}`;
}

function stableBlockId(seed: string) {
  return seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "block";
}

function collectConfidenceValues(input: unknown, bucket: number[] = []) {
  if (Array.isArray(input)) {
    input.forEach((item) => collectConfidenceValues(item, bucket));
    return bucket;
  }

  if (!input || typeof input !== "object") {
    return bucket;
  }

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "number" && /(confidence|score)$/i.test(key) && value >= 0 && value <= 1) {
      bucket.push(value);
      continue;
    }

    if (typeof value === "object") {
      collectConfidenceValues(value, bucket);
    }
  }

  return bucket;
}

function computeConfidence(page: PaddleLayoutResult) {
  const values = collectConfidenceValues(page.prunedResult);
  if (!values.length) {
    return 0.95;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(average.toFixed(4));
}

function mapBlockKind(label?: string): EvidenceBlockKind {
  switch (label) {
    case "doc_title":
    case "title":
      return "title";
    case "table":
      return "table";
    case "formula":
      return "formula";
    case "figure":
    case "chart":
    case "image":
      return "figure";
    case "header":
    case "header_image":
      return "header";
    case "footer":
    case "footer_image":
      return "footer";
    case "text":
    case "paragraph_title":
    case "abstract":
      return "text";
    default:
      return "other";
  }
}

function blockLabelText(kind: EvidenceBlockKind) {
  switch (kind) {
    case "title":
      return "标题";
    case "table":
      return "表格";
    case "formula":
      return "公式";
    case "figure":
      return "图像";
    case "header":
      return "页眉";
    case "footer":
      return "页脚";
    case "text":
      return "正文";
    default:
      return "其他";
  }
}

function mapPageBlocks(page: PaddleLayoutResult, pageId: string) {
  const rawBlocks = page.prunedResult?.parsing_res_list ?? [];

  return rawBlocks
    .map((block, index) => {
      const content = block.block_content?.trim();
      if (!content) {
        return null;
      }

      const kind = mapBlockKind(block.block_label);
      const evidenceBlock: EvidenceBlock = {
        id: `${pageId}-${stableBlockId(`${block.block_label}-${block.block_id ?? index}`)}`,
        kind,
        title: `${blockLabelText(kind)} ${index + 1}`,
        content,
        confidence: computeConfidence(page),
        bbox: block.block_bbox,
      };

      return evidenceBlock;
    })
    .filter((block): block is EvidenceBlock => block !== null);
}

function buildDocumentSummary(pages: EvidencePage[]) {
  const stats = pages.reduce(
    (summary, page) => {
      summary.titles += page.blocks.filter((block) => block.kind === "title").length;
      summary.tables += page.blocks.filter((block) => block.kind === "table").length;
      summary.formulas += page.blocks.filter((block) => block.kind === "formula").length;
      return summary;
    },
    { titles: 0, tables: 0, formulas: 0 },
  );

  return `识别到 ${pages.length} 页，${stats.titles} 个标题，${stats.tables} 个表格，${stats.formulas} 个公式块。`;
}

function buildEvidenceDocument(file: File, uploadIndex: number, pages: PaddleLayoutResult[], assetId: string): EvidenceDocument {
  const displayName = file.name.replace(/\.[^.]+$/, "") || `文件 ${uploadIndex + 1}`;
  const mappedPages: EvidencePage[] = pages.map((page, pageIndex) => {
    const pageId = `${assetId}-page-${pageIndex + 1}`;
    const blocks = mapPageBlocks(page, pageId);

    return {
      id: pageId,
      pageNumber: pageIndex + 1,
      title: `${displayName} - 第 ${pageIndex + 1} 页`,
      markdown: page.markdown?.text?.trim() ?? "",
      confidence: computeConfidence(page),
      width: page.prunedResult?.width,
      height: page.prunedResult?.height,
      blocks,
    };
  });

  const averageConfidence =
    mappedPages.reduce((sum, page) => sum + page.confidence, 0) / Math.max(1, mappedPages.length);

  return {
    id: `${assetId}-document`,
    assetId,
    assetName: file.name,
    assetType: file.type,
    routing: "ocr",
    summary: buildDocumentSummary(mappedPages),
    pageCount: mappedPages.length,
    averageConfidence: Number(averageConfidence.toFixed(4)),
    pages: mappedPages,
  };
}

function buildVisionDocument(file: File, assetId: string): EvidenceDocument {
  return {
    id: `${assetId}-document`,
    assetId,
    assetName: file.name,
    assetType: file.type,
    routing: "vision",
    summary: "该图片命中视觉路由，跳过 OCR。",
    pageCount: 1,
    averageConfidence: 0,
    pages: [
      {
        id: `${assetId}-page-1`,
        pageNumber: 1,
        title: `${file.name} - 视觉图片`,
        markdown: "该图片未执行 OCR，建议直接在对话中描述场景、主题、风格或细节。",
        confidence: 0,
        blocks: [
          {
            id: `${assetId}-vision-note`,
            kind: "figure",
            title: "视觉图片",
            content: "命中视觉路由规则，跳过文档解析。",
            confidence: 0,
          },
        ],
      },
    ],
  };
}

function mapLayoutResultsToBlocks(file: File, uploadIndex: number, pages: PaddleLayoutResult[], assetId: string) {
  const displayName = file.name.replace(/\.[^.]+$/, "") || `文件 ${uploadIndex + 1}`;

  return pages
    .map((page, pageIndex) => {
      const text = page.markdown?.text?.trim();
      if (!text) {
        return null;
      }

      return {
        id: `${assetId}-ocr-page-${pageIndex + 1}`,
        page: `${displayName} - 第 ${pageIndex + 1} 页`,
        text,
        confidence: computeConfidence(page),
      } satisfies OcrBlock;
    })
    .filter((block): block is OcrBlock => block !== null);
}

async function shouldRouteToOcr(file: File) {
  if (getFileType(file) === 0) {
    return true;
  }

  if (!file.type.startsWith("image/")) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  if (OCR_HINT_PATTERN.test(lowerName)) {
    return true;
  }

  if (VISION_HINT_PATTERN.test(lowerName)) {
    return false;
  }

  return true;
}

export async function processUploadedFiles(files: File[], assetIds: string[]) {
  const allBlocks: OcrBlock[] = [];
  const documents: EvidenceDocument[] = [];
  const mappedFiles: UploadResultFile[] = [];

  for (const [index, file] of files.entries()) {
    const assetId = assetIds[index]?.trim() || stableUploadId(file.name, index);
    const routeToOcr = await shouldRouteToOcr(file);

    if (!routeToOcr) {
      documents.push(buildVisionDocument(file, assetId));
      mappedFiles.push({
        id: assetId,
        name: file.name,
        size: file.size,
        type: file.type,
        page: `图片 ${index + 1}`,
        routing: "vision",
      });
      continue;
    }

    const pages = await callPaddleDocumentParsingApi(file);
    allBlocks.push(...mapLayoutResultsToBlocks(file, index, pages, assetId));
    documents.push(buildEvidenceDocument(file, index, pages, assetId));
    mappedFiles.push({
      id: assetId,
      name: file.name,
      size: file.size,
      type: file.type,
      page: file.type === "application/pdf" ? `PDF ${index + 1}` : `图片 ${index + 1}`,
      routing: "ocr",
    });
  }

  return {
    ok: true as const,
    files: mappedFiles,
    ocrBlocks: allBlocks,
    documents,
  };
}
