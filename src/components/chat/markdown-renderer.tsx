"use client";

import { Check, Copy } from "@/components/ui/icons";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function nodeToText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(nodeToText).join("");
  }
  if (node && typeof node === "object" && "props" in node) {
    const element = node as { props?: { children?: ReactNode } };
    return nodeToText(element.props?.children);
  }
  return "";
}

function CodeFrame({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const value = nodeToText(children);

  return (
    <div className="group/code relative my-4 overflow-hidden rounded-lg border border-border bg-[#090909] text-white">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="absolute right-2 top-2 z-10 bg-white/5 text-white/70 opacity-0 transition group-hover/code:opacity-100"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
        aria-label="复制代码"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
      <pre className="overflow-x-auto p-4 text-sm leading-6">{children}</pre>
    </div>
  );
}

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("max-w-none text-sm leading-7 text-card-foreground/82", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          pre: ({ children }) => <CodeFrame>{children}</CodeFrame>,
          p: ({ children }) => <p className="my-3">{children}</p>,
          h1: ({ children }) => <h1 className="font-heading mb-3 mt-5 text-2xl font-semibold text-card-foreground">{children}</h1>,
          h2: ({ children }) => <h2 className="font-heading mb-3 mt-5 text-xl font-semibold text-card-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold text-card-foreground">{children}</h3>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-2 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-2 pl-5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-2 border-primary/30 pl-4 text-muted-foreground">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-muted/70 px-3 py-2 text-card-foreground">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border px-3 py-2 text-card-foreground/75">{children}</td>,
          a: ({ children, href }) => (
            <a className="text-primary underline underline-offset-4" href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src ?? ""}
              alt={alt ?? ""}
              className="my-4 max-h-80 rounded-lg border border-border object-contain"
            />
          ),
          code: ({ children, className }) => {
            const value = nodeToText(children);
            const isBlock = Boolean(className?.includes("language-")) || value.includes("\n");

            if (isBlock) {
              return <code className={className}>{children}</code>;
            }

            return (
              <code className={cn("rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-primary", className)}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
