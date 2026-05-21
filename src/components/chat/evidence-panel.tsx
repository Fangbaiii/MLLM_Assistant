"use client";

import { motion } from "framer-motion";
import {
  BadgeCheck,
  Eye,
  FileText,
  Gauge,
  ImageIcon,
  ScanLine,
  Sparkles,
  Workflow,
} from "@/components/ui/icons";
import { EvidenceDocumentCard } from "@/components/chat/evidence-document-card";
import { LazyMarkdownRenderer } from "@/components/chat/lazy-markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadDropzone } from "@/components/upload/upload-dropzone";
import { cn } from "@/lib/utils";
import { useEvidenceStore } from "@/store/evidence-store";
import { useChatSessionStore } from "@/store/chat-session-store";

export function EvidencePanel({ className, embedded = false }: { className?: string; embedded?: boolean }) {
  const ocrBlocks = useEvidenceStore((state) => state.ocrBlocks);
  const assets = useEvidenceStore((state) => state.uploadedAssets);
  const documents = useEvidenceStore((state) => state.evidenceDocuments);
  const isThinking = useChatSessionStore((state) => state.isThinking);

  const ocrAssetCount = documents.filter((document) => document.routing === "ocr").length;
  const visionAssetCount = documents.filter((document) => document.routing === "vision").length;
  const totalPages = documents.reduce((sum, document) => sum + document.pageCount, 0);
  const tableCount = documents.reduce(
    (sum, document) =>
      sum +
      document.pages.reduce(
        (pageSum, page) => pageSum + page.blocks.filter((block) => block.kind === "table").length,
        0,
      ),
    0,
  );

  return (
    <aside
      className={cn(
        "h-full border-l border-border bg-sidebar text-sidebar-foreground",
        embedded ? "flex flex-col" : "hidden h-full flex-col lg:flex",
        className,
      )}
    >
      <div className="border-b border-sidebar-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--sidebar)_72%,black),color-mix(in_oklab,var(--sidebar)_96%,transparent))] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Evidence Studio</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              结构化文档证据、分页预览、表格卡片和视觉路由都集中在这里。
            </p>
          </div>
          <Badge className="bg-primary/15 text-primary hover:bg-primary/15">PaddleOCR Live</Badge>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <UploadDropzone compact />

          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-xl border border-sidebar-border bg-background/60 p-3">
              <ScanLine className="mb-2 size-4 text-primary" />
              <p className="text-[11px] text-muted-foreground">OCR 段落</p>
              <p className="text-sm font-medium">{ocrBlocks.length}</p>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-background/60 p-3">
              <FileText className="mb-2 size-4 text-primary" />
              <p className="text-[11px] text-muted-foreground">文档数</p>
              <p className="text-sm font-medium">{documents.length}</p>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-background/60 p-3">
              <Eye className="mb-2 size-4 text-primary" />
              <p className="text-[11px] text-muted-foreground">总页数</p>
              <p className="text-sm font-medium">{totalPages}</p>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-background/60 p-3">
              <Workflow className="mb-2 size-4 text-primary" />
              <p className="text-[11px] text-muted-foreground">表格块</p>
              <p className="text-sm font-medium">{tableCount}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
              <div className="flex items-center gap-2 text-xs text-primary">
                <BadgeCheck className="size-3.5" />
                OCR Routing
              </div>
              <p className="mt-2 text-lg font-semibold text-foreground">{ocrAssetCount}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                PDF、截图、文档页等素材优先走结构化 OCR。
              </p>
            </div>
            <div className="rounded-2xl border border-amber-500/28 bg-amber-500/12 p-3">
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-100">
                <Sparkles className="size-3.5" />
                Vision Routing
              </div>
              <p className="mt-2 text-lg font-semibold text-foreground">{visionAssetCount}</p>
              <p className="mt-1 text-xs leading-5 text-amber-900/80 dark:text-muted-foreground">
                自然图片会跳过 OCR，避免浪费与噪音结果。
              </p>
            </div>
          </div>

          <Tabs defaultValue="document" className="w-full">
            <TabsList className="grid w-full grid-cols-4 rounded-xl bg-background/70">
              <TabsTrigger value="document">文档</TabsTrigger>
              <TabsTrigger value="ocr">OCR</TabsTrigger>
              <TabsTrigger value="preview">预览</TabsTrigger>
              <TabsTrigger value="vlm">路由</TabsTrigger>
            </TabsList>

            <TabsContent value="document" className="mt-4 space-y-4">
              {isThinking && documents.length === 0 ? (
                <div className="space-y-3">
                  <Skeleton className="h-28 rounded-2xl bg-muted" />
                  <Skeleton className="h-48 rounded-2xl bg-muted" />
                </div>
              ) : documents.length ? (
                documents.map((document, index) => (
                  <motion.div
                    key={document.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                  >
                    <EvidenceDocumentCard
                      document={document}
                      asset={assets.find((asset) => asset.id === document.assetId)}
                    />
                  </motion.div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-sidebar-border bg-background/50 p-6 text-center">
                  <FileText className="mx-auto mb-3 size-6 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground/88">
                    上传 PDF、截图或页面图片后，这里会展示完整文档证据。
                  </p>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    我们会把标题、正文、表格和公式拆开显示，并按页做轻量预览。
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="ocr" className="mt-4 space-y-3">
              {isThinking && ocrBlocks.length === 0 ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 rounded-lg bg-muted" />
                  <Skeleton className="h-20 rounded-lg bg-muted" />
                </div>
              ) : ocrBlocks.length ? (
                ocrBlocks.map((block, index) => (
                  <motion.div
                    key={block.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className="rounded-2xl border border-sidebar-border bg-background/60 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs text-primary">
                        <ScanLine className="size-3.5" />
                        {block.page}
                      </span>
                      <span className="text-xs text-muted-foreground">{Math.round(block.confidence * 100)}%</span>
                    </div>
                    <LazyMarkdownRenderer content={block.text} className="text-sidebar-foreground/82" />
                  </motion.div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-sidebar-border bg-background/50 p-6 text-center">
                  <ScanLine className="mx-auto mb-3 size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">还没有 OCR 文本块。</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="preview" className="mt-4">
              {assets.length ? (
                <div className="grid gap-3">
                  {assets.map((asset) => {
                    const relatedDocument = documents.find((document) => document.assetId === asset.id);
                    const routing = relatedDocument?.routing ?? asset.routing ?? "ocr";

                    return (
                      <div
                        key={asset.id}
                        className="overflow-hidden rounded-2xl border border-sidebar-border bg-background/60 p-2"
                      >
                        <div className="relative overflow-hidden rounded-xl bg-card/40">
                          {asset.type === "application/pdf" ? (
                            <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-sidebar-border bg-card/40 px-3 text-center text-sm text-muted-foreground">
                              PDF 分页会显示在文档标签内
                            </div>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={asset.previewUrl} alt={asset.name} className="aspect-[4/3] w-full object-cover" />
                          )}
                          <div className="absolute left-2 top-2">
                            <Badge
                              className={
                                routing === "ocr"
                                  ? "bg-primary/85 text-primary-foreground hover:bg-primary/85"
                                  : "bg-amber-500/85 text-amber-950 hover:bg-amber-500/85"
                              }
                            >
                              {routing === "ocr" ? "OCR" : "Vision"}
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 px-1">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <ImageIcon className="size-3.5 text-primary" />
                              <span className="truncate">{asset.name}</span>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {relatedDocument?.pageCount ? `${relatedDocument.pageCount} 页` : "1 页"} ·{" "}
                              {routing === "ocr" ? "已进入结构化 OCR 证据" : "已进入视觉理解链路"}
                            </p>
                          </div>
                          <div className="rounded-full border border-sidebar-border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                            {Math.max(1, Math.round(asset.size / 1024))} KB
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-sidebar-border bg-background/50 p-6 text-center">
                  <Eye className="mx-auto mb-3 size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">上传文件后，这里会显示缩略图和路由标签。</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="vlm" className="mt-4">
              <div className="rounded-2xl border border-sidebar-border bg-background/60 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm">
                  <Gauge className="size-4 text-primary" />
                  OCR / Vision 路由策略
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  PDF 默认走 OCR；自然图片更偏向视觉理解；截图和文档类素材优先保留证据链。
                </p>
                <Separator className="my-4 bg-sidebar-border" />
                <div className="space-y-2 text-xs leading-6 text-muted-foreground">
                  <p>1. PDF 会先做结构化解析，提取标题、正文、表格和公式块。</p>
                  <p>2. 图片按文件名和内容倾向决定 OCR 或视觉理解。</p>
                  <p>3. 右侧面板只负责展示，不承担业务决策。</p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </aside>
  );
}
