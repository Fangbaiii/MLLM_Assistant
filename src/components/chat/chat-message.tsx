"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot, ChevronDown, ImageIcon, Sparkles, UserRound } from "@/components/ui/icons";
import { useState } from "react";
import { LazyMarkdownRenderer } from "@/components/chat/lazy-markdown-renderer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { detectChatMode, modeLabel, stripLeadingCommand } from "@/lib/chat-commands";
import type { ChatMessage as ChatMessageType } from "@/types/app";
import { cn } from "@/lib/utils";

function MessageModeBadge({ mode, invert = false }: { mode: ChatMessageType["mode"]; invert?: boolean }) {
  if (!mode || mode === "default") return null;

  return (
    <Badge
      className={cn(
        "mb-3 hover:bg-primary/10",
        invert
          ? "border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground"
          : "border-primary/20 bg-primary/10 text-primary",
      )}
    >
      {modeLabel(mode)}
    </Badge>
  );
}

function UserMessageContent({ message }: { message: ChatMessageType }) {
  const fallbackMode = detectChatMode(message.content);
  const displayMode = message.mode ?? fallbackMode;
  const body = displayMode === "default" ? message.content : stripLeadingCommand(message.content);

  return (
    <div className="space-y-2">
      <MessageModeBadge mode={displayMode} invert />
      {body ? <div className="whitespace-pre-wrap text-sm leading-7">{body}</div> : null}
    </div>
  );
}

export function ThinkingState() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/70 p-4">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Sparkles className="size-4 animate-pulse" />
      </div>
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-2/3 rounded-full bg-muted" />
        <Skeleton className="h-3 w-1/2 rounded-full bg-muted" />
      </div>
      <div className="flex gap-1">
        {[0, 1, 2].map((dot) => (
          <motion.span
            key={dot}
            className="size-1.5 rounded-full bg-primary"
            animate={{ y: [0, -5, 0], opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.16 }}
          />
        ))}
      </div>
    </div>
  );
}

export function ChatMessage({ message }: { message: ChatMessageType }) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const isUser = message.role === "user";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={cn("flex gap-3 px-4 py-4 sm:px-8", isUser && "justify-end")}
    >
      {!isUser ? (
        <Avatar className="mt-1 size-9 border border-border bg-card">
          <AvatarFallback className="bg-card text-primary">
            <Bot className="size-4" />
          </AvatarFallback>
        </Avatar>
      ) : null}

      <div className={cn("max-w-[min(780px,100%)]", isUser && "order-first")}>
        <div
          className={cn(
            "rounded-lg border px-5 py-4 shadow-[0_18px_48px_rgba(0,0,0,0.16)]",
            isUser
              ? "border-primary/20 bg-primary text-primary-foreground"
              : "border-border bg-card/85 text-card-foreground backdrop-blur-xl",
          )}
        >
          {message.isStreaming && !message.content ? (
            <ThinkingState />
          ) : isUser ? (
            <UserMessageContent message={message} />
          ) : (
            <>
              <MessageModeBadge mode={message.mode} />
              <LazyMarkdownRenderer content={message.content} />
              {message.isStreaming ? (
                <span className="mt-2 inline-flex items-center gap-2 text-xs text-primary/85">
                  <motion.span
                    className="inline-block h-4 w-1 rounded-full bg-primary"
                    animate={{ opacity: [0.25, 1, 0.25] }}
                    transition={{ duration: 0.85, repeat: Infinity }}
                  />
                  正在流式输出
                </span>
              ) : null}
            </>
          )}

          {message.attachments?.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {message.attachments.map((asset) => (
                <div key={asset.id} className="overflow-hidden rounded-lg border border-black/10 bg-black/5 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.previewUrl} alt={asset.name} className="aspect-[4/3] w-full rounded-md object-cover" />
                  <div className="mt-2 flex items-center gap-2 text-xs opacity-75">
                    <ImageIcon className="size-3.5" />
                    <span className="truncate">{asset.name}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {!isUser && message.evidence?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.evidence.map((evidence) => (
              <Badge key={evidence.id} className="border-border bg-card/80 text-muted-foreground">
                {evidence.label}
                {evidence.score ? ` ${Math.round(evidence.score * 100)}%` : ""}
              </Badge>
            ))}
          </div>
        ) : null}

        {!isUser && message.reasoning ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card/70">
            <Button
              variant="ghost"
              className="h-10 w-full justify-between rounded-none px-4 text-muted-foreground hover:bg-muted/60"
              onClick={() => setReasoningOpen((open) => !open)}
            >
              推理过程
              <ChevronDown className={cn("size-4 transition", reasoningOpen && "rotate-180")} />
            </Button>
            <AnimatePresence initial={false}>
              {reasoningOpen ? (
                <motion.p
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-border px-4 py-3 text-sm leading-6 text-muted-foreground"
                >
                  {message.reasoning}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </div>

      {isUser ? (
        <Avatar className="mt-1 size-9 border border-primary/20 bg-primary">
          <AvatarFallback className="bg-primary text-primary-foreground">
            <UserRound className="size-4" />
          </AvatarFallback>
        </Avatar>
      ) : null}
    </motion.article>
  );
}
