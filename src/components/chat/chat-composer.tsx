"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState } from "react";
import { UploadDropzone } from "@/components/upload/upload-dropzone";
import { PanelDivider } from "@/components/workbench/panel-divider";
import { Button } from "@/components/ui/button";
import { ImagePlus, PanelRightOpen, SendHorizontal } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { streamChat } from "@/lib/api";
import { commandOptions, parseLeadingCommand } from "@/lib/chat-commands";
import { createId } from "@/lib/id";
import { cn } from "@/lib/utils";
import { defaultEvidence } from "@/mocks/data";
import { useChatSessionStore } from "@/store/chat-session-store";
import { useEvidenceStore } from "@/store/evidence-store";
import {
  DEFAULT_COMPOSER_HEIGHT,
  MAX_COMPOSER_HEIGHT,
  MIN_COMPOSER_HEIGHT,
  useWorkbenchStore,
} from "@/store/workbench-store";
import type { ChatMessage, ChatMode } from "@/types/app";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function ChatComposer() {
  const dividerHeight = 8;
  const [value, setValue] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const currentSessionId = useChatSessionStore((state) => state.currentSessionId);
  const mode = useChatSessionStore((state) => state.mode);
  const addMessage = useChatSessionStore((state) => state.addMessage);
  const patchMessage = useChatSessionStore((state) => state.patchMessage);
  const setMode = useChatSessionStore((state) => state.setMode);
  const setThinking = useChatSessionStore((state) => state.setThinking);
  const updateMessageContent = useChatSessionStore((state) => state.updateMessageContent);
  const updateSession = useChatSessionStore((state) => state.updateSession);
  const assets = useEvidenceStore((state) => state.uploadedAssets);
  const clearUploadedAssets = useEvidenceStore((state) => state.clearUploadedAssets);
  const setEvidenceDocuments = useEvidenceStore((state) => state.setEvidenceDocuments);
  const setOcrBlocks = useEvidenceStore((state) => state.setOcrBlocks);
  const composerHeight = useWorkbenchStore((state) => state.composerHeight);
  const setComposerHeight = useWorkbenchStore((state) => state.setComposerHeight);
  const toggleRightPanel = useWorkbenchStore((state) => state.toggleRightPanel);

  const handleChange = (nextValue: string) => {
    if (!nextValue) {
      setValue("");
      setMode("default");
      return;
    }

    const parsed = parseLeadingCommand(nextValue);
    if (parsed.matched) {
      setMode(parsed.mode);
      setValue(parsed.body);
      return;
    }

    setValue(nextValue);
  };

  const switchMode = (nextMode: ChatMode) => {
    setMode(mode === nextMode ? "default" : nextMode);
    textareaRef.current?.focus();
  };

  const beginResize = (event: React.MouseEvent<HTMLButtonElement> | React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    if ("setPointerCapture" in event.currentTarget && "pointerId" in event) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // no-op
      }
    }

    const startY = event.clientY;
    const startHeight = composerHeight;

    const onMove = (moveEvent: MouseEvent | PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      const nextHeight = clamp(startHeight - delta, MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT);
      setComposerHeight(nextHeight);
    };

    const stopResize = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("mouseup", stopResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("mouseup", stopResize);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("mousemove", onMove);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("pointerup", stopResize, { once: true });
    document.addEventListener("mouseup", stopResize, { once: true });
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("mouseup", stopResize, { once: true });
  };

  const submit = async () => {
    const body = value.trim();
    if (!body || isStreaming) return;

    const requestMode = mode;
    const attachmentIds = assets.map((asset) => asset.id);
    const createdAt = new Date().toISOString();

    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content: body,
      createdAt,
      mode: requestMode,
      attachments: assets.length ? [...assets] : undefined,
    };

    const assistantId = createId("assistant");
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt,
      mode: requestMode,
      evidence: defaultEvidence,
      reasoning: "正在整理证据并生成回答。",
      isStreaming: true,
    };

    setValue("");
    setMode("default");
    setIsStreaming(true);
    setThinking(true);
    setUploadOpen(false);
    addMessage(userMessage);
    addMessage(assistantPlaceholder);

    try {
      let mergedContent = "";
      let streamError = "";
      let thinkingFinished = false;

      await streamChat(
        {
          sessionId: currentSessionId,
          message: body,
          mode: requestMode,
          attachmentIds,
        },
        {
          onToken: (token) => {
            if (!thinkingFinished) {
              setThinking(false);
              thinkingFinished = true;
            }
            mergedContent += token;
            updateMessageContent(assistantId, mergedContent, true);
          },
          onMeta: (meta) => {
            if (attachmentIds.length === 0) {
              setOcrBlocks(meta.ocrBlocks ?? []);
              setEvidenceDocuments([]);
            }
            if (meta.model) {
              updateSession(currentSessionId, { model: meta.model });
            }
            patchMessage(assistantId, {
              evidence: meta.evidence,
              reasoning: meta.reasoning,
              mode: meta.mode ?? requestMode,
            });
          },
          onDone: () => {
            if (!thinkingFinished) {
              setThinking(false);
              thinkingFinished = true;
            }
          },
          onError: (message) => {
            streamError = message;
          },
        },
      );

      if (streamError) {
        throw new Error(streamError);
      }

      updateMessageContent(assistantId, mergedContent, false);
      clearUploadedAssets();
      setUploadOpen(false);
    } catch (error) {
      setThinking(false);
      const message = error instanceof Error ? error.message : "抱歉，服务暂时没有响应，请稍后再试。";
      updateMessageContent(assistantId, message, false);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="relative shrink-0 border-t border-border bg-background/86 backdrop-blur-2xl" style={{ height: composerHeight + dividerHeight }}>
      <PanelDivider
        orientation="horizontal"
        label="调整回答框高度"
        onDoubleClick={() => setComposerHeight(DEFAULT_COMPOSER_HEIGHT)}
        onPointerDown={beginResize}
      />

      <AnimatePresence initial={false}>
        {uploadOpen ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="pointer-events-none absolute bottom-[calc(100%+10px)] left-0 right-0 z-20 px-4 sm:px-8"
          >
            <div className="pointer-events-auto mx-auto max-h-[42vh] w-full max-w-4xl overflow-y-auto">
              <UploadDropzone compact />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex h-[calc(100%-8px)] flex-col gap-3 overflow-hidden px-4 py-4 sm:px-8">
        <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card/80 p-2 shadow-[0_22px_80px_rgba(0,0,0,0.20)] backdrop-blur-2xl">
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-2">
            <span className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground">回答模式</span>
            <button
              type="button"
              onClick={() => switchMode("default")}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition",
                mode === "default"
                  ? "border-primary/35 bg-primary/12 text-primary"
                  : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
              )}
            >
              直接回答
            </button>
            {commandOptions.map((option) => (
              <button
                key={option.command}
                type="button"
                onClick={() => switchMode(option.mode)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition",
                  mode === option.mode
                    ? "border-primary/35 bg-primary/12 text-primary"
                    : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {option.command}
              </button>
            ))}
          </div>

          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={mode === "default" ? "上传图片或文档后直接提问..." : "直接输入你的问题..."}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent px-4 py-3 text-base leading-7 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0"
          />

          <div className="flex items-center justify-between gap-3 px-2 pb-1">
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={cn("rounded-lg text-muted-foreground", uploadOpen && "bg-muted text-primary")}
                      onClick={() => setUploadOpen((open) => !open)}
                      aria-label="上传文件"
                    />
                  }
                >
                  <ImagePlus className="size-4" />
                </TooltipTrigger>
                <TooltipContent>上传文件</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="rounded-lg text-muted-foreground lg:hidden"
                      onClick={toggleRightPanel}
                      aria-label="打开证据面板"
                    />
                  }
                >
                  <PanelRightOpen className="size-4" />
                </TooltipTrigger>
                <TooltipContent>证据面板</TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center gap-3">
              {assets.length ? <span className="text-xs text-muted-foreground">已附加 {assets.length} 个文件</span> : null}
              <Button
                type="button"
                className="h-10 rounded-lg px-4"
                disabled={!value.trim() || isStreaming}
                onClick={() => void submit()}
              >
                {isStreaming ? "生成中" : "发送"}
                <SendHorizontal className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
