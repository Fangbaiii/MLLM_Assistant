import { useChatSessionStore } from "@/store/chat-session-store";
import { useEvidenceStore } from "@/store/evidence-store";
import { useWorkbenchStore } from "@/store/workbench-store";

const STORAGE_KEYS = ["mllm-studio-chat-sessions", "mllm-studio-workbench"];

export function clearAppCache() {
  for (const key of STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }

  useChatSessionStore.getState().resetSessions();
  useEvidenceStore.getState().clearEvidenceWorkspace();
  useWorkbenchStore.getState().resetWorkbench();
}
