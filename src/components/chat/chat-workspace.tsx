"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessage, ThinkingState } from "@/components/chat/chat-message";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { EvidencePanel } from "@/components/chat/evidence-panel";
import { WorkbenchShell } from "@/components/workbench/workbench-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, PanelRightOpen, Sparkles } from "@/components/ui/icons";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { commandOptions } from "@/lib/chat-commands";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useChatSessionStore } from "@/store/chat-session-store";
import { useWorkbenchStore } from "@/store/workbench-store";

export function ChatWorkspace() {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const sessions = useChatSessionStore((state) => state.sessions);
  const currentSessionId = useChatSessionStore((state) => state.currentSessionId);
  const isThinking = useChatSessionStore((state) => state.isThinking);
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen);
  const leftSidebarWidth = useWorkbenchStore((state) => state.leftSidebarWidth);
  const rightPanelWidth = useWorkbenchStore((state) => state.rightPanelWidth);
  const setRightPanelOpen = useWorkbenchStore((state) => state.setRightPanelOpen);
  const setLeftSidebarWidth = useWorkbenchStore((state) => state.setLeftSidebarWidth);
  const setRightPanelWidth = useWorkbenchStore((state) => state.setRightPanelWidth);

  const currentSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) ?? sessions[0],
    [currentSessionId, sessions],
  );
  const relativeTime = useRelativeTime(currentSession?.updatedAt);
  const messageCount = currentSession?.messages.length;
  const lastMessageContent = currentSession?.messages.at(-1)?.content;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastMessageContent, messageCount]);

  const centerPane = (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background/82 px-4 backdrop-blur-2xl sm:px-6">
        <div className="flex items-center gap-3">
          <Sheet>
            <SheetTrigger
              render={<Button variant="ghost" size="icon" className="rounded-lg text-muted-foreground lg:hidden" />}
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[310px] border-border bg-sidebar p-0" showCloseButton={false}>
              <ChatSidebar className="border-r-0" />
            </SheetContent>
          </Sheet>

          <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-primary">
            <Sparkles className="size-4" />
          </div>

          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium text-foreground">
              {currentSession?.title ?? "AI Chat Workspace"}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {currentSession?.messages.length ?? 0} 条消息 · {relativeTime}
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="rounded-lg text-muted-foreground lg:hidden"
          onClick={() => setRightPanelOpen(true)}
          aria-label="打开证据面板"
        >
          <PanelRightOpen className="size-5" />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_55%)]" />
        <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-end py-6">
          {currentSession?.messages.length ? (
            currentSession.messages.map((message) => <ChatMessage key={message.id} message={message} />)
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-6 py-12 text-center"
            >
              <Badge className="mb-6 border-border bg-card text-foreground hover:bg-card">MLLM Studio</Badge>
              <h2 className="font-heading mx-auto max-w-2xl text-5xl font-semibold leading-tight text-foreground">
                上传图片或文档截图，然后开始提问。
              </h2>
              <div className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-2">
                {commandOptions.map((option) => (
                  <div key={option.command} className="rounded-lg border border-border bg-card/80 p-4 shadow-sm">
                    <p className="text-xs font-semibold tracking-[0.12em] text-primary">{option.command}</p>
                    <h3 className="mt-2 text-lg font-semibold text-card-foreground">{option.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{option.description}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {isThinking && currentSession?.messages.at(-1)?.content ? (
            <div className="px-4 py-4 sm:px-8">
              <ThinkingState />
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <ChatComposer />
    </section>
  );

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <WorkbenchShell
        leftWidth={leftSidebarWidth}
        rightWidth={rightPanelWidth}
        defaultLeftWidth={296}
        defaultRightWidth={420}
        onLeftWidthChange={setLeftSidebarWidth}
        onRightWidthChange={setRightPanelWidth}
        left={<ChatSidebar className="h-full border-r-0" />}
        center={centerPane}
        right={<EvidencePanel className="h-full border-l-0" />}
      />

      <Sheet open={rightPanelOpen} onOpenChange={setRightPanelOpen}>
        <SheetContent side="right" className="w-[360px] border-border bg-sidebar p-0 lg:hidden" showCloseButton>
          <SheetHeader className="sr-only">
            <SheetTitle>证据面板</SheetTitle>
          </SheetHeader>
          <EvidencePanel embedded className="border-l-0" />
        </SheetContent>
      </Sheet>
    </main>
  );
}
