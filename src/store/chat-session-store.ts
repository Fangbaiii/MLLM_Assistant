"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { stripLeadingCommand } from "@/lib/chat-commands";
import { createId } from "@/lib/id";
import { resolveModelForMode } from "@/lib/model-routing";
import { initialSessions } from "@/mocks/data";
import type { ChatMessage, ChatMode, ChatSession } from "@/types/app";

type PersistedSessionState = Pick<ChatSessionStore, "sessions" | "currentSessionId" | "mode">;

type SessionMetaPatch = Partial<Pick<ChatSession, "model" | "pinned" | "summary" | "title">>;

type ChatSessionStore = {
  sessions: ChatSession[];
  currentSessionId: string;
  mode: ChatMode;
  isThinking: boolean;
  setMode: (mode: ChatMode) => void;
  setThinking: (thinking: boolean) => void;
  selectSession: (id: string) => void;
  newSession: () => void;
  renameSession: (id: string, title: string) => void;
  duplicateSession: (id: string) => void;
  deleteSession: (id: string) => void;
  togglePinSession: (id: string) => void;
  clearSessionMessages: (id: string) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessageContent: (id: string, content: string, isStreaming?: boolean) => void;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  updateSession: (id: string, patch: SessionMetaPatch) => void;
  setSessions: (sessions: ChatSession[]) => void;
  resetSessions: () => void;
};

const now = () => new Date().toISOString();

const cleanSummary = (content: string) =>
  stripLeadingCommand(content)
    .replace(/```[\s\S]*?```/g, "代码片段")
    .replace(/[#*_`>|-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);

const makeBlankSession = (mode: ChatMode = "default"): ChatSession => ({
  id: createId("session"),
  title: "新的多模态会话",
  model: resolveModelForMode(mode),
  updatedAt: now(),
  pinned: false,
  summary: "等待上传图片或输入问题。",
  messages: [],
});

const touchSession = (session: ChatSession) => ({
  ...session,
  updatedAt: now(),
});

const ensureSessions = (sessions: ChatSession[], mode: ChatMode) =>
  sessions.length ? sessions : [makeBlankSession(mode)];

const serializeSessions = (sessions: ChatSession[]): ChatSession[] =>
  sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => ({
      ...message,
      attachments: undefined,
      isStreaming: false,
    })),
  }));

const resetSessionState = () => ({
  sessions: initialSessions,
  currentSessionId: initialSessions[0]?.id ?? makeBlankSession().id,
  mode: "default" as ChatMode,
  isThinking: false,
});

export const useChatSessionStore = create<ChatSessionStore>()(
  persist(
    (set, get) => ({
      ...resetSessionState(),
      setMode: (mode) => set({ mode }),
      setThinking: (thinking) => set({ isThinking: thinking }),
      selectSession: (id) => set({ currentSessionId: id }),
      newSession: () => {
        const session = makeBlankSession(get().mode);
        set((state) => ({
          sessions: [session, ...state.sessions],
          currentSessionId: session.id,
        }));
      },
      renameSession: (id, title) => {
        const nextTitle = title.trim();
        if (!nextTitle) return;

        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id ? touchSession({ ...session, title: nextTitle }) : session,
          ),
        }));
      },
      duplicateSession: (id) =>
        set((state) => {
          const source = state.sessions.find((session) => session.id === id);
          if (!source) return state;

          const copy: ChatSession = {
            ...source,
            id: createId("session"),
            title: `${source.title} 副本`,
            pinned: false,
            updatedAt: now(),
            messages: source.messages.map((message) => ({
              ...message,
              id: createId(message.role),
              createdAt: now(),
            })),
          };

          return {
            sessions: [copy, ...state.sessions],
            currentSessionId: copy.id,
          };
        }),
      deleteSession: (id) =>
        set((state) => {
          const remaining = ensureSessions(
            state.sessions.filter((session) => session.id !== id),
            state.mode,
          );

          return {
            sessions: remaining,
            currentSessionId:
              state.currentSessionId === id ? remaining[0].id : state.currentSessionId,
          };
        }),
      togglePinSession: (id) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id ? touchSession({ ...session, pinned: !session.pinned }) : session,
          ),
        })),
      clearSessionMessages: (id) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id
              ? touchSession({
                  ...session,
                  title: "新的多模态会话",
                  summary: "会话已清空，可以重新开始。",
                  messages: [],
                })
              : session,
          ),
        })),
      addMessage: (message) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === state.currentSessionId
              ? touchSession({
                  ...session,
                  title:
                    session.messages.length === 0 && message.role === "user"
                      ? cleanSummary(message.content) || session.title
                      : session.title,
                  summary: cleanSummary(message.content) || session.summary,
                  messages: [...session.messages, message],
                })
              : session,
          ),
        })),
      updateMessageContent: (id, content, isStreaming = false) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === state.currentSessionId
              ? touchSession({
                  ...session,
                  summary: content ? cleanSummary(content) : session.summary,
                  messages: session.messages.map((message) =>
                    message.id === id ? { ...message, content, isStreaming } : message,
                  ),
                })
              : session,
          ),
        })),
      patchMessage: (id, patch) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === state.currentSessionId
              ? touchSession({
                  ...session,
                  messages: session.messages.map((message) =>
                    message.id === id ? { ...message, ...patch } : message,
                  ),
                })
              : session,
          ),
        })),
      updateSession: (id, patch) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id ? touchSession({ ...session, ...patch }) : session,
          ),
        })),
      setSessions: (sessions) =>
        set((state) => ({
          sessions: sessions.length > 0 ? sessions : state.sessions,
          currentSessionId: sessions[0]?.id ?? state.currentSessionId,
        })),
      resetSessions: () => set(resetSessionState()),
    }),
    {
      name: "mllm-studio-chat-sessions",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedSessionState => ({
        sessions: [], // 不持久化会话列表，强制从后端拉取
        currentSessionId: state.currentSessionId,
        mode: state.mode,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<PersistedSessionState>),
        isThinking: false,
      }),
    },
  ),
);
