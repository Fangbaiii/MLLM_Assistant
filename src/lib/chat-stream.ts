export type StreamFrame = {
  text: string;
  delay: number;
};

function tokenDelay(token: string, codeMode: boolean) {
  if (!token.trim()) return 4;
  if (codeMode) return 18 + Math.min(token.length * 2, 34);
  if (/[。！？；]/.test(token)) return 160;
  if (/[，、:,.]/.test(token)) return 64;
  if (/```/.test(token)) return 28;
  return 14 + Math.min(token.length * 2, 26);
}

function splitTextSegment(segment: string) {
  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter("zh", { granularity: "word" })
      : null;

  if (segmenter) {
    return Array.from(segmenter.segment(segment), (piece) => piece.segment);
  }

  return segment.match(/[\u4e00-\u9fff]+|[A-Za-z0-9_./-]+|\s+|[^\s]/g) ?? [segment];
}

export function buildStreamFrames(content: string): StreamFrame[] {
  const frames: StreamFrame[] = [];
  const chunks = content.split(/(```[\s\S]*?```)/g).filter(Boolean);

  for (const chunk of chunks) {
    if (chunk.startsWith("```")) {
      const lines = chunk.split("\n");

      for (const line of lines) {
        frames.push({
          text: `${line}\n`,
          delay: line.startsWith("```") ? 32 : 26 + Math.min(line.length, 60),
        });
      }

      frames.push({ text: "\n", delay: 24 });
      continue;
    }

    const tokens = splitTextSegment(chunk);
    for (const token of tokens) {
      frames.push({
        text: token,
        delay: tokenDelay(token, false),
      });
    }
  }

  return frames;
}
