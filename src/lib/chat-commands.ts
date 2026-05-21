import type { ChatMode } from "@/types/app";

export type SlashMode = Exclude<ChatMode, "default">;
export type SlashCommand = `/${SlashMode}`;

export const commandOptions: Array<{
  mode: SlashMode;
  command: SlashCommand;
  title: string;
  description: string;
}> = [
  {
    mode: "explain",
    command: "/explain",
    title: "讲解",
    description: "展开结构、依据和步骤，适合方案说明、页面拆解和汇报表达。",
  },
  {
    mode: "think",
    command: "/think",
    title: "深思",
    description: "先整理证据再下结论，适合需要更稳妥推理的多模态问答。",
  },
];

const commandPattern = /^\s*(\/(explain|think))\b/i;

export function detectChatMode(text: string): ChatMode {
  const match = text.match(commandPattern);
  if (!match) return "default";
  return match[2].toLowerCase() as SlashMode;
}

export function getLeadingCommand(text: string): SlashCommand | null {
  const match = text.match(commandPattern);
  if (!match) return null;
  return match[1].toLowerCase() as SlashCommand;
}

export function stripLeadingCommand(text: string): string {
  return text.replace(commandPattern, "").trim();
}

export function parseLeadingCommand(text: string): { mode: ChatMode; body: string; matched: boolean } {
  const match = text.match(commandPattern);
  if (!match) return { mode: "default", body: text, matched: false };
  return {
    mode: match[2].toLowerCase() as SlashMode,
    body: text.slice(match[0].length).replace(/^\s+/, ""),
    matched: true,
  };
}

export function modeLabel(mode: ChatMode) {
  if (mode === "explain") return "讲解模式";
  if (mode === "think") return "深思模式";
  return "直接回答";
}

export function getCommandOption(mode: SlashMode | null | undefined) {
  if (!mode) return null;
  return commandOptions.find((option) => option.mode === mode) ?? null;
}
