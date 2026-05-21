"use client";

import { cn } from "@/lib/utils";

type PanelDividerProps = {
  className?: string;
  label: string;
  orientation?: "horizontal" | "vertical";
  onDoubleClick?: () => void;
  onPointerDown: (event: React.MouseEvent<HTMLButtonElement> | React.PointerEvent<HTMLButtonElement>) => void;
};

export function PanelDivider({
  className,
  label,
  orientation = "vertical",
  onDoubleClick,
  onPointerDown,
}: PanelDividerProps) {
  const isVertical = orientation === "vertical";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onMouseDown={onPointerDown}
      className={cn(
        "group relative bg-transparent touch-none select-none",
        isVertical ? "h-full w-2 cursor-col-resize" : "h-2 w-full cursor-row-resize",
        className,
      )}
    >
      <span
        className={cn(
          "absolute rounded-full bg-border/60 transition group-hover:bg-primary/70 group-active:bg-primary",
          isVertical ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
      <span
        className={cn(
          "absolute rounded-full border border-border/70 bg-card/90 opacity-0 shadow-sm transition group-hover:opacity-100 group-active:opacity-100",
          isVertical
            ? "inset-y-1/2 left-1/2 h-16 w-1.5 -translate-x-1/2 -translate-y-1/2"
            : "inset-x-1/2 top-1/2 h-1.5 w-16 -translate-x-1/2 -translate-y-1/2",
        )}
      />
    </button>
  );
}
