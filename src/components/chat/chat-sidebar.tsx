"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  Check,
  Clock3,
  Copy,
  Moon,
  MoreHorizontal,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  SunDim,
  Trash2,
} from "@/components/ui/icons";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { modeLabel } from "@/lib/chat-commands";
import { clearAppCache } from "@/lib/app-cache";
import { cn } from "@/lib/utils";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useChatSessionStore } from "@/store/chat-session-store";
import { useEvidenceStore } from "@/store/evidence-store";
import { useWorkbenchStore } from "@/store/workbench-store";
import type { ChatSession, DemoPreference } from "@/types/app";

function sessionPreview(session: ChatSession) {
  const latest = session.messages.at(-1)?.content;
  return (latest || session.summary || "空会话，等待第一条问题。")
    .replace(/```[\s\S]*?```/g, "代码片段")
    .replace(/[#*_`>|-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 54);
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-2 mt-4 flex items-center justify-between px-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      <span className="text-[11px] text-muted-foreground">{count}</span>
    </div>
  );
}

function PreferenceButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      className={cn("h-9 rounded-lg", !active && "bg-background/60")}
      onClick={onClick}
    >
      {children}
      {active ? <Check className="size-4" /> : null}
    </Button>
  );
}

function SessionCard({
  session,
  active,
  onSelect,
  onRename,
  onTogglePin,
  onDuplicate,
  onClear,
  onDelete,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const relativeTime = useRelativeTime(session.updatedAt);
  const messageCount = session.messages.length;

  const runAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <div
      className={cn(
        "group relative overflow-visible rounded-lg border border-transparent transition hover:border-border hover:bg-sidebar-accent/70",
        active && "border-border bg-sidebar-accent shadow-sm",
      )}
    >
      <button type="button" className="w-full px-3 py-3 text-left" onClick={onSelect}>
        <div className="flex items-start gap-2 pr-8">
          {session.pinned ? <Pin className="mt-0.5 size-3.5 shrink-0 text-primary" /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-sidebar-foreground">{session.title}</p>
              {active ? <span className="size-1.5 rounded-full bg-primary" /> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{sessionPreview(session)}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Clock3 className="size-3" />
          <span>{relativeTime}</span>
          <span>·</span>
          <span>{messageCount} 条</span>
        </div>
      </button>

      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute right-2 top-2 z-10 rounded-lg text-muted-foreground/75 transition hover:text-foreground"
        aria-label="会话操作"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((open) => !open);
        }}
      >
        <MoreHorizontal className="size-4" />
      </Button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-2 top-10 z-30 w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          <div className="px-2 py-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            会话操作
          </div>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => runAction(onRename)}
          >
            <PencilLine className="size-4" />
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => runAction(onTogglePin)}
          >
            {session.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {session.pinned ? "取消置顶" : "置顶会话"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => runAction(onDuplicate)}
          >
            <Copy className="size-4" />
            复制会话
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => runAction(onClear)}
          >
            <RotateCcw className="size-4" />
            清空消息
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
            onClick={() => runAction(onDelete)}
          >
            <Trash2 className="size-4" />
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ChatSidebar({ className }: { className?: string }) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deletingSession, setDeletingSession] = useState<ChatSession | null>(null);

  const sessions = useChatSessionStore((state) => state.sessions);
  const currentSessionId = useChatSessionStore((state) => state.currentSessionId);
  const mode = useChatSessionStore((state) => state.mode);
  const selectSession = useChatSessionStore((state) => state.selectSession);
  const newSession = useChatSessionStore((state) => state.newSession);
  const renameSession = useChatSessionStore((state) => state.renameSession);
  const duplicateSession = useChatSessionStore((state) => state.duplicateSession);
  const deleteSession = useChatSessionStore((state) => state.deleteSession);
  const togglePinSession = useChatSessionStore((state) => state.togglePinSession);
  const clearSessionMessages = useChatSessionStore((state) => state.clearSessionMessages);
  const searchQuery = useWorkbenchStore((state) => state.searchQuery);
  const darkMode = useWorkbenchStore((state) => state.darkMode);
  const reducedMotion = useWorkbenchStore((state) => state.reducedMotion);
  const demoPreference = useWorkbenchStore((state) => state.demoPreference);
  const setSearchQuery = useWorkbenchStore((state) => state.setSearchQuery);
  const setDarkMode = useWorkbenchStore((state) => state.setDarkMode);
  const toggleDarkMode = useWorkbenchStore((state) => state.toggleDarkMode);
  const toggleReducedMotion = useWorkbenchStore((state) => state.toggleReducedMotion);
  const setDemoPreference = useWorkbenchStore((state) => state.setDemoPreference);
  const clearEvidenceWorkspace = useEvidenceStore((state) => state.clearEvidenceWorkspace);

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sessions
      .filter((session) => {
        if (!query) return true;
        return (
          session.title.toLowerCase().includes(query) ||
          session.model.toLowerCase().includes(query) ||
          sessionPreview(session).toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [searchQuery, sessions]);

  const pinnedSessions = filteredSessions.filter((session) => session.pinned);
  const recentSessions = filteredSessions.filter((session) => !session.pinned);

  const openRename = (session: ChatSession) => {
    setRenamingId(session.id);
    setDraftTitle(session.title);
  };

  const submitRename = () => {
    if (renamingId) {
      renameSession(renamingId, draftTitle);
    }
    setRenamingId(null);
  };

  const setPreference = (preference: DemoPreference) => {
    setDemoPreference(preference);
  };

  const openSession = (id: string) => {
    selectSession(id);
    clearEvidenceWorkspace();
  };

  const createSession = () => {
    newSession();
    clearEvidenceWorkspace();
  };

  const clearSession = (id: string) => {
    clearSessionMessages(id);
    if (id === currentSessionId) {
      clearEvidenceWorkspace();
    }
  };

  const removeSession = (session: ChatSession) => {
    deleteSession(session.id);
    if (session.id === currentSessionId) {
      clearEvidenceWorkspace();
    }
    setDeletingSession(null);
  };

  return (
    <aside className={cn("flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground", className)}>
      <div className="p-4">
        <Link href="/" className="mb-5 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg border border-sidebar-border bg-background/70">
            <Sparkles className="size-4 text-primary" />
          </span>
          <div>
            <p className="text-sm font-semibold">MLLM Studio</p>
            <p className="text-xs text-muted-foreground">Multimodal Workspace</p>
          </div>
        </Link>

        <Button className="h-10 w-full rounded-lg" onClick={createSession}>
          <Plus className="size-4" />
          新建会话
        </Button>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-sidebar-border bg-background/60 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Sessions</p>
            <p className="text-sm font-medium">{sessions.length}</p>
          </div>
          <div className="rounded-lg border border-sidebar-border bg-background/60 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Mode</p>
            <p className="truncate text-sm font-medium">{modeLabel(mode)}</p>
          </div>
          <div className="rounded-lg border border-sidebar-border bg-background/60 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Pinned</p>
            <p className="text-sm font-medium">{sessions.filter((session) => session.pinned).length}</p>
          </div>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索会话或摘要"
            className="h-10 rounded-lg border-sidebar-border bg-background/70 pl-9"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3">
        {pinnedSessions.length ? (
          <>
            <SectionHeader title="Pinned" count={pinnedSessions.length} />
            <div className="space-y-1">
              {pinnedSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  active={session.id === currentSessionId}
                  onSelect={() => openSession(session.id)}
                  onRename={() => openRename(session)}
                  onTogglePin={() => togglePinSession(session.id)}
                  onDuplicate={() => duplicateSession(session.id)}
                  onClear={() => clearSession(session.id)}
                  onDelete={() => setDeletingSession(session)}
                />
              ))}
            </div>
          </>
        ) : null}

        <SectionHeader title="Recent" count={recentSessions.length} />
        <div className="space-y-1 pb-4">
          {recentSessions.length ? (
            recentSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                active={session.id === currentSessionId}
                onSelect={() => openSession(session.id)}
                onRename={() => openRename(session)}
                onTogglePin={() => togglePinSession(session.id)}
                onDuplicate={() => duplicateSession(session.id)}
                onClear={() => clearSession(session.id)}
                onDelete={() => setDeletingSession(session)}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-sidebar-border p-4 text-center text-sm text-muted-foreground">
              没有匹配的会话。
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="space-y-3 border-t border-sidebar-border p-4">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="rounded-lg bg-background/60" onClick={toggleDarkMode}>
            {darkMode ? <Moon className="size-4" /> : <SunDim className="size-4" />}
            {darkMode ? "深色" : "浅色"}
          </Button>
          <Button variant="outline" className="rounded-lg bg-background/60" onClick={() => setSettingsOpen(true)}>
            <Settings className="size-4" />
            设置
          </Button>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-background/60 p-3">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary text-primary-foreground">AI</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm">本地工作台</p>
            <p className="text-xs text-muted-foreground">结构清晰、状态分层、问题更好定位</p>
          </div>
        </div>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="premium-panel max-w-lg rounded-lg border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
            <DialogDescription>管理主题、动画偏好和本地缓存。</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <section>
              <p className="mb-2 text-sm font-medium">主题</p>
              <div className="grid grid-cols-2 gap-2">
                <PreferenceButton active={darkMode} onClick={() => setDarkMode(true)}>
                  <Moon className="size-4" />
                  深色
                </PreferenceButton>
                <PreferenceButton active={!darkMode} onClick={() => setDarkMode(false)}>
                  <SunDim className="size-4" />
                  浅色
                </PreferenceButton>
              </div>
            </section>

            <section>
              <p className="mb-2 text-sm font-medium">动画偏好</p>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full justify-between rounded-lg bg-background/60"
                onClick={toggleReducedMotion}
              >
                {reducedMotion ? "减少动效" : "完整动效"}
                {reducedMotion ? <Check className="size-4" /> : <Sparkles className="size-4" />}
              </Button>
            </section>

            <section>
              <p className="mb-2 text-sm font-medium">演示偏好</p>
              <div className="grid grid-cols-2 gap-2">
                <PreferenceButton active={demoPreference === "balanced"} onClick={() => setPreference("balanced")}>
                  产品演示
                </PreferenceButton>
                <PreferenceButton active={demoPreference === "quiet"} onClick={() => setPreference("quiet")}>
                  安静模式
                </PreferenceButton>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-background/60 p-3">
              <p className="text-sm font-medium">本地缓存</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                会清空会话、工作台设置和临时证据数据，并恢复内置示例。
              </p>
              <Button
                type="button"
                variant="destructive"
                className="mt-3 rounded-lg"
                onClick={() => {
                  clearAppCache();
                  setSettingsOpen(false);
                }}
              >
                <RotateCcw className="size-4" />
                清空本地会话缓存
              </Button>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renamingId)}
        onOpenChange={(open) => {
          if (!open) setRenamingId(null);
        }}
      >
        <DialogContent className="premium-panel rounded-lg border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>给这段多模态问答起一个更清晰的标题。</DialogDescription>
          </DialogHeader>
          <Input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitRename();
            }}
            className="h-11 rounded-lg bg-background/70"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenamingId(null)}>
              取消
            </Button>
            <Button onClick={submitRename}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deletingSession)}
        onOpenChange={(open) => {
          if (!open) setDeletingSession(null);
        }}
      >
        <DialogContent className="premium-panel rounded-lg border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
            <DialogDescription>
              确认删除“{deletingSession?.title ?? ""}”？此操作只会移除当前会话内容。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeletingSession(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => deletingSession && removeSession(deletingSession)}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
