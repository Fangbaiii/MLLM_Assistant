import type { ChatMode } from "@/types/app";

const MODE_MODEL_MAP: Record<ChatMode, string> = {
  default: "Qwen/Qwen3-VL-8B-Instruct",
  explain: "Qwen/Qwen3-VL-8B-Instruct",
  think: "Qwen/Qwen3-VL-8B-Instruct",
};

export function resolveModelForMode(mode: ChatMode) {
  return MODE_MODEL_MAP[mode];
}
