"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkbenchStore } from "@/store/workbench-store";
import { SessionProvider, useSession } from "next-auth/react";
import { useChatSessionStore } from "@/store/chat-session-store";

function ThemeBridge() {
  const darkMode = useWorkbenchStore((state) => state.darkMode);
  const reducedMotion = useWorkbenchStore((state) => state.reducedMotion);
  const demoPreference = useWorkbenchStore((state) => state.demoPreference);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", darkMode);
    root.dataset.theme = darkMode ? "dark" : "light";
    root.dataset.motion = reducedMotion ? "reduced" : "full";
    root.dataset.demo = demoPreference;
  }, [darkMode, demoPreference, reducedMotion]);

  return null;
}

function AuthStateObserver({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const resetSessions = useChatSessionStore((state) => state.resetSessions);

  useEffect(() => {
    // 当退出登录或身份失效时，立即清空内存中的聊天记录
    if (status === "unauthenticated") {
      resetSessions();
    }
  }, [status, resetSessions]);

  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <AuthStateObserver>
          <TooltipProvider delay={120}>
            <ThemeBridge />
            {children}
          </TooltipProvider>
        </AuthStateObserver>
      </SessionProvider>
    </QueryClientProvider>
  );
}
