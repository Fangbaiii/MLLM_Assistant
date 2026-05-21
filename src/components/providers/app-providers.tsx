"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkbenchStore } from "@/store/workbench-store";

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
      <TooltipProvider delay={120}>
        <ThemeBridge />
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
