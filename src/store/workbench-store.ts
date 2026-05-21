"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DemoPreference } from "@/types/app";

export const DEFAULT_COMPOSER_HEIGHT = 212;
export const MIN_COMPOSER_HEIGHT = 160;
export const MAX_COMPOSER_HEIGHT = 420;

type PersistedWorkbenchState = Pick<
  WorkbenchStore,
  | "darkMode"
  | "reducedMotion"
  | "demoPreference"
  | "leftSidebarWidth"
  | "rightPanelWidth"
  | "composerHeight"
>;

type WorkbenchStore = {
  searchQuery: string;
  darkMode: boolean;
  reducedMotion: boolean;
  demoPreference: DemoPreference;
  rightPanelOpen: boolean;
  leftSidebarWidth: number;
  rightPanelWidth: number;
  composerHeight: number;
  setSearchQuery: (query: string) => void;
  setDarkMode: (enabled: boolean) => void;
  toggleDarkMode: () => void;
  toggleReducedMotion: () => void;
  setDemoPreference: (preference: DemoPreference) => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setComposerHeight: (height: number) => void;
  resetWorkbench: () => void;
};

const resetWorkbenchState = () => ({
  searchQuery: "",
  darkMode: true,
  reducedMotion: false,
  demoPreference: "balanced" as DemoPreference,
  rightPanelOpen: false,
  leftSidebarWidth: 296,
  rightPanelWidth: 420,
  composerHeight: DEFAULT_COMPOSER_HEIGHT,
});

export const useWorkbenchStore = create<WorkbenchStore>()(
  persist(
    (set) => ({
      ...resetWorkbenchState(),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setDarkMode: (enabled) => set({ darkMode: enabled }),
      toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),
      toggleReducedMotion: () => set((state) => ({ reducedMotion: !state.reducedMotion })),
      setDemoPreference: (preference) => set({ demoPreference: preference }),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
      setLeftSidebarWidth: (width) => set({ leftSidebarWidth: width }),
      setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
      setComposerHeight: (height) => set({ composerHeight: height }),
      resetWorkbench: () => set(resetWorkbenchState()),
    }),
    {
      name: "mllm-studio-workbench",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedWorkbenchState => ({
        darkMode: state.darkMode,
        reducedMotion: state.reducedMotion,
        demoPreference: state.demoPreference,
        leftSidebarWidth: state.leftSidebarWidth,
        rightPanelWidth: state.rightPanelWidth,
        composerHeight: state.composerHeight,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<PersistedWorkbenchState>),
        searchQuery: "",
        rightPanelOpen: false,
      }),
    },
  ),
);
