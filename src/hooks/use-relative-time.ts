"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/time";

export function useRelativeTime(value?: string, fallback = "最近更新") {
  const [label, setLabel] = useState(() => (value ? formatRelativeTime(value) : fallback));

  useEffect(() => {
    const update = () => setLabel(value ? formatRelativeTime(value) : fallback);
    const frame = window.requestAnimationFrame(update);
    const timer = value ? window.setInterval(update, 60_000) : undefined;

    return () => {
      window.cancelAnimationFrame(frame);
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [fallback, value]);

  return label;
}
