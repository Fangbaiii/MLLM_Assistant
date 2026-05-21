import type { ChatMode } from "@/types/app";

const MODE_MODEL_MAP: Record<ChatMode, string> = {
  default: "Qwen3-VL-8B-Instruct",
  explain: "Qwen3-VL-8B-Instruct",
  think: "Qwen2.5-VL-7B-Instruct",
};

export function resolveModelForMode(mode: ChatMode) {
  return MODE_MODEL_MAP[mode];
}
