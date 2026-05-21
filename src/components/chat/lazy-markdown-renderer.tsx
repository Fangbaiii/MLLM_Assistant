"use client";

import { lazy, Suspense } from "react";
import { cn } from "@/lib/utils";

const MarkdownRenderer = lazy(async () => {
  const markdownModule = await import("@/components/chat/markdown-renderer");
  return { default: markdownModule.MarkdownRenderer };
});

type LazyMarkdownRendererProps = {
  className?: string;
  content: string;
};

export function LazyMarkdownRenderer({ content, className }: LazyMarkdownRendererProps) {
  return (
    <Suspense
      fallback={
        <div className={cn("whitespace-pre-wrap text-sm leading-7 text-card-foreground/82", className)}>{content}</div>
      }
    >
      <MarkdownRenderer content={content} className={className} />
    </Suspense>
  );
}
