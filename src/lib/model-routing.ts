import type { ChatMode } from "@/types/app";

const DEFAULT_BASE_MODEL = "mllm-qwen3-vl-base";
const DEFAULT_LORA_MODEL = "mllm-qwen3-vl-document-repair-360";
const MULTIMODAL_PATTERN = /(图片|图像|截图|照片|文档|表格|图表|pdf|ocr|附件|页面|票据|报告|幻灯片|chart|table|image|photo|document|figure|screenshot|invoice|receipt|pdf|ocr)/i;
const LONG_TEXT_PATTERN = /(写作|润色|总结|方案|代码|推理|创意|故事|邮件|规划|rewrite|code|plan|essay|creative)/i;

const MODE_MODEL_MAP: Record<ChatMode, string> = {
  default: "Qwen/Qwen3-VL-8B-Instruct",
  explain: "Qwen/Qwen3-VL-8B-Instruct",
  think: "Qwen/Qwen3-VL-8B-Instruct",
};

export function resolveModelForMode(mode: ChatMode) {
  return MODE_MODEL_MAP[mode];
}

export function resolveModelForRequest(params: {
  mode: ChatMode;
  message: string;
  hasAttachments: boolean;
}) {
  const forcedModel = process.env.MLLM_MODEL_NAME?.trim();
  const routingEnabled = process.env.MLLM_MODEL_ROUTING_ENABLED?.trim().toLowerCase() === "true";
  if (forcedModel && !routingEnabled) {
    return forcedModel;
  }

  const baseModel = process.env.MLLM_BASE_MODEL_NAME?.trim() || DEFAULT_BASE_MODEL;
  const loraModel = process.env.MLLM_LORA_MODEL_NAME?.trim() || DEFAULT_LORA_MODEL;

  if (!routingEnabled) {
    return forcedModel || resolveModelForMode(params.mode);
  }

  if (params.hasAttachments || MULTIMODAL_PATTERN.test(params.message)) {
    return loraModel;
  }

  if (params.mode === "think" || LONG_TEXT_PATTERN.test(params.message)) {
    return baseModel;
  }

  return forcedModel || loraModel;
}
