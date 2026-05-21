"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Eye,
  FileText,
  Gauge,
  ImageIcon,
  Layers3,
  ScanText,
  Sparkles,
  Workflow,
} from "@/components/ui/icons";
import { LazyMarkdownRenderer } from "@/components/chat/lazy-markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EvidenceBlock, EvidenceBlockKind, EvidenceDocument, EvidencePage, UploadedAsset } from "@/types/app";
import { cn } from "@/lib/utils";

type EvidenceDocumentCardProps = {
  document: EvidenceDocument;
  asset?: UploadedAsset;
};

function normalizeTableHtml(content: string) {
  const trimmed = content.trim();
  if (!/<table[\s>]/i.test(trimmed)) {
    return null;
  }

  return trimmed
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(html|body)[^>]*>/gi, "");
}

function EvidenceTablePreview({ content }: { content: string }) {
  const tableHtml = normalizeTableHtml(content);

  if (!tableHtml) {
    return <LazyMarkdownRenderer content={content} className="text-sidebar-foreground/84" />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-300/12 bg-black/10">
      <div className="overflow-x-auto">
        <div
          className="evidence-html-table min-w-max text-sm text-sidebar-foreground/88"
          dangerouslySetInnerHTML={{ __html: tableHtml }}
        />
      </div>
    </div>
  );
}

const blockKindLabels: Record<EvidenceBlockKind, string> = {
  title: "标题",
  text: "正文",
  table: "表格",
  formula: "公式",
  figure: "图像",
  header: "页眉",
  footer: "页脚",
  other: "其他",
};

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function collectBlocks(page: EvidencePage, kind: EvidenceBlockKind) {
  return page.blocks.filter((block) => block.kind === kind);
}

function blockPreview(blocks: EvidenceBlock[]) {
  const text = blocks.map((block) => block.content).join(" ");
  return text.length > 72 ? `${text.slice(0, 72)}...` : text;
}

function PagePill({
  page,
  active,
  onClick,
}: {
  page: EvidencePage;
  active: boolean;
  onClick: () => void;
}) {
  const titles = collectBlocks(page, "title").length;
  const tables = collectBlocks(page, "table").length;
  const formulas = collectBlocks(page, "formula").length;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative min-w-[112px] overflow-hidden rounded-xl border p-3 text-left transition",
        active
          ? "border-primary/45 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_16%,transparent),rgba(255,255,255,0.02))] shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
          : "border-sidebar-border bg-background/55 hover:border-primary/25 hover:bg-background/75",
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_45%)] opacity-80" />
      <div className="relative space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium tracking-[0.14em] text-primary/90">PAGE {page.pageNumber}</span>
          <span className="text-[10px] text-muted-foreground">{formatPercent(page.confidence)}</span>
        </div>
        <div className="aspect-[4/5] rounded-lg border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-2">
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={`${page.id}-line-${index + 1}`}
                className={cn(
                  "h-1 rounded-full bg-white/18",
                  index === 0 ? "w-3/4" : index === 4 ? "w-8/12" : "w-full",
                )}
              />
            ))}
            {tables ? <div className="mt-2 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] text-primary">Table</div> : null}
            {formulas ? (
              <div className="rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200">
                Formula
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
          <span>{titles} 标题</span>
          <span>{tables} 表格</span>
          <span>{formulas} 公式</span>
        </div>
      </div>
    </button>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-sidebar-border bg-background/45 px-4 py-8 text-center">
      <p className="text-sm font-medium text-foreground/88">{title}</p>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

export function EvidenceDocumentCard({ document, asset }: EvidenceDocumentCardProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const currentPage = document.pages[Math.min(pageIndex, document.pages.length - 1)] ?? document.pages[0];

  const grouped = useMemo(
    () => ({
      titles: collectBlocks(currentPage, "title"),
      texts: collectBlocks(currentPage, "text"),
      tables: collectBlocks(currentPage, "table"),
      formulas: collectBlocks(currentPage, "formula"),
      figures: collectBlocks(currentPage, "figure"),
    }),
    [currentPage],
  );

  const totals = useMemo(
    () =>
      document.pages.reduce(
        (summary, page) => {
          summary.titles += collectBlocks(page, "title").length;
          summary.tables += collectBlocks(page, "table").length;
          summary.formulas += collectBlocks(page, "formula").length;
          summary.texts += collectBlocks(page, "text").length;
          return summary;
        },
        { titles: 0, tables: 0, formulas: 0, texts: 0 },
      ),
    [document.pages],
  );

  const routingBadge =
    document.routing === "ocr"
      ? { label: "OCR", className: "bg-primary/15 text-primary hover:bg-primary/15" }
      : { label: "Vision", className: "bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-200" };

  return (
    <Card className="overflow-hidden border border-sidebar-border/90 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_96%,black_4%),color-mix(in_oklab,var(--card)_88%,transparent))] py-0 shadow-[0_22px_80px_rgba(0,0,0,0.18)]">
      <CardHeader className="border-b border-sidebar-border/80 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge className={routingBadge.className}>{routingBadge.label}</Badge>
              <Badge className="bg-white/8 text-muted-foreground hover:bg-white/8">
                {document.pageCount} 页
              </Badge>
            </div>
            <CardTitle className="mt-3 truncate text-[15px]">{document.assetName}</CardTitle>
            <CardDescription className="mt-2 text-xs leading-6">{document.summary}</CardDescription>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 text-right text-[11px]">
            <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
              <p className="text-muted-foreground">置信度</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatPercent(document.averageConfidence)}</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
              <p className="text-muted-foreground">正文块</p>
              <p className="mt-1 text-sm font-medium text-foreground">{totals.texts}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2 text-[11px]">
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="size-3.5" />
              标题
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{totals.titles}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
            <div className="flex items-center gap-2 text-primary">
              <Layers3 className="size-3.5" />
              表格
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{totals.tables}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
            <div className="flex items-center gap-2 text-primary">
              <Workflow className="size-3.5" />
              公式
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{totals.formulas}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
            <div className="flex items-center gap-2 text-primary">
              <Eye className="size-3.5" />
              路由
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{document.routing === "ocr" ? "结构化" : "视觉理解"}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-4 py-4">
        {asset?.type !== "application/pdf" && asset?.previewUrl ? (
          <div className="overflow-hidden rounded-2xl border border-sidebar-border/70 bg-background/55">
            <div className="flex items-center justify-between border-b border-sidebar-border/70 px-4 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-2">
                <ImageIcon className="size-3.5 text-primary" />
                原始文件预览
              </span>
              <span>{asset.name}</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.previewUrl} alt={asset.name} className="max-h-56 w-full object-cover" />
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium tracking-[0.14em] text-primary/90">PAGE STRIP</p>
              <p className="mt-1 text-xs text-muted-foreground">仅渲染当前页详情，其他页保持轻量缩略信息，兼顾性能。</p>
            </div>
            <div className="rounded-full border border-sidebar-border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
              当前第 {currentPage.pageNumber} / {document.pageCount} 页
            </div>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {document.pages.map((page, index) => (
              <PagePill key={page.id} page={page} active={index === pageIndex} onClick={() => setPageIndex(index)} />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-sidebar-border/80 bg-background/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{currentPage.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                页面尺寸 {currentPage.width ?? "-"} × {currentPage.height ?? "-"} · 置信度 {formatPercent(currentPage.confidence)}
              </p>
            </div>
            <Badge className="bg-white/8 text-muted-foreground hover:bg-white/8">
              {currentPage.blocks.length} 个证据块
            </Badge>
          </div>

          <Tabs defaultValue="content" className="mt-4">
            <TabsList className="grid w-full grid-cols-5 rounded-xl bg-background/80">
              <TabsTrigger value="content">正文</TabsTrigger>
              <TabsTrigger value="titles">标题</TabsTrigger>
              <TabsTrigger value="tables">表格</TabsTrigger>
              <TabsTrigger value="formulas">公式</TabsTrigger>
              <TabsTrigger value="figures">其他</TabsTrigger>
            </TabsList>

            <TabsContent value="content" className="mt-4">
              {grouped.texts.length || currentPage.markdown ? (
                <div className="space-y-3">
                  {grouped.texts.length ? (
                    grouped.texts.map((block) => (
                      <div key={block.id} className="rounded-2xl border border-sidebar-border/75 bg-card/55 p-4">
                        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-2">
                            <ScanText className="size-3.5 text-primary" />
                            {block.title}
                          </span>
                          <span>{formatPercent(block.confidence)}</span>
                        </div>
                        <LazyMarkdownRenderer content={block.content} className="text-sidebar-foreground/85" />
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-sidebar-border/75 bg-card/55 p-4">
                      <LazyMarkdownRenderer content={currentPage.markdown} className="text-sidebar-foreground/85" />
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState title="这一页没有正文块" description="如果是纯表格、纯公式或封面页，正文区域会为空。" />
              )}
            </TabsContent>

            <TabsContent value="titles" className="mt-4">
              {grouped.titles.length ? (
                <div className="grid gap-3">
                  {grouped.titles.map((block) => (
                    <div key={block.id} className="rounded-2xl border border-primary/18 bg-primary/8 p-4">
                      <div className="mb-2 flex items-center justify-between text-xs text-primary/90">
                        <span className="flex items-center gap-2">
                          <Sparkles className="size-3.5" />
                          {block.title}
                        </span>
                        <span>{formatPercent(block.confidence)}</span>
                      </div>
                      <p className="text-lg font-semibold leading-7 text-foreground">{block.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="未识别到标题块" description="这一页暂时没有独立标题，可能内容全部落在正文区域。" />
              )}
            </TabsContent>

            <TabsContent value="tables" className="mt-4">
              {grouped.tables.length ? (
                <div className="grid gap-3">
                  {grouped.tables.map((block) => (
                    <Card key={block.id} size="sm" className="border border-cyan-400/16 bg-cyan-500/6 py-0">
                      <CardHeader className="border-b border-cyan-400/14 px-4 py-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2 text-cyan-100">
                            <Layers3 className="size-3.5" />
                            {block.title}
                          </span>
                          <span className="text-cyan-700/80 dark:text-cyan-50/70">{formatPercent(block.confidence)}</span>
                        </div>
                        <CardDescription className="text-[11px] text-cyan-800/70 dark:text-cyan-50/65">
                          独立表格卡片渲染，避免长 Markdown 混排影响阅读和性能。
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="px-4 py-4">
                        <EvidenceTablePreview content={block.content} />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <EmptyState title="未识别到表格块" description="如果接口返回了结构化表格，这里会以独立卡片展示，而不是混在正文里。" />
              )}
            </TabsContent>

            <TabsContent value="formulas" className="mt-4">
              {grouped.formulas.length ? (
                <div className="grid gap-3">
                  {grouped.formulas.map((block) => (
                    <div key={block.id} className="rounded-2xl border border-emerald-400/18 bg-emerald-500/8 p-4">
                      <div className="mb-2 flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-100">
                        <span className="flex items-center gap-2">
                          <Workflow className="size-3.5" />
                          {block.title}
                        </span>
                        <span>{formatPercent(block.confidence)}</span>
                      </div>
                      <LazyMarkdownRenderer content={block.content} className="text-sidebar-foreground/86" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="未识别到公式块" description="后续有公式时，会单独卡片展示，便于和正文、表格分层查看。" />
              )}
            </TabsContent>

            <TabsContent value="figures" className="mt-4">
              {grouped.figures.length ? (
                <div className="grid gap-3">
                  {grouped.figures.map((block) => (
                    <div key={block.id} className="rounded-2xl border border-sidebar-border/75 bg-card/55 p-4">
                      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-2">
                          <FileText className="size-3.5 text-primary" />
                          {block.title}
                        </span>
                        <span>{blockKindLabels[block.kind]}</span>
                      </div>
                      <LazyMarkdownRenderer content={block.content} className="text-sidebar-foreground/84" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="暂无额外结构块" description="页眉、页脚、图片说明等非正文结构，后续会在这里集中展示。" />
              )}
            </TabsContent>
          </Tabs>
        </div>

        <AnimatePresence initial={false}>
          {document.routing === "vision" ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="rounded-2xl border border-amber-400/16 bg-amber-500/8 p-4"
            >
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-100">
                <BadgeCheck className="size-4" />
                已自动跳过 OCR
              </div>
              <p className="mt-2 text-sm leading-6 text-amber-900/80 dark:text-amber-50/75">
                这类图片更像自然场景或低文本密度图像。系统会优先走视觉理解链路，避免浪费 OCR 调用和前端渲染成本。
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="rounded-2xl border border-sidebar-border/70 bg-background/45 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Gauge className="size-3.5 text-primary" />
            页面摘要速览
          </div>
          <div className="grid gap-2">
            {document.pages.map((page) => (
              <button
                type="button"
                key={`${page.id}-summary`}
                onClick={() => setPageIndex(page.pageNumber - 1)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition",
                  page.pageNumber === currentPage.pageNumber
                    ? "border-primary/35 bg-primary/8"
                    : "border-sidebar-border bg-background/45 hover:border-primary/18 hover:bg-background/70",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-foreground/88">第 {page.pageNumber} 页</span>
                  <span className="text-[11px] text-muted-foreground">{formatPercent(page.confidence)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{blockPreview(page.blocks)}</p>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
