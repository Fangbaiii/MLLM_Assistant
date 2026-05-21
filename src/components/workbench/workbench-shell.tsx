"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ReactNode } from "react";
import { PanelDivider } from "@/components/workbench/panel-divider";

const HANDLE_WIDTH = 8;
const MIN_CENTER_WIDTH = 560;

type WorkbenchShellProps = {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  leftWidth: number;
  rightWidth: number;
  defaultLeftWidth: number;
  defaultRightWidth: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  minRightWidth?: number;
  maxRightWidth?: number;
  onLeftWidthChange: (width: number) => void;
  onRightWidthChange: (width: number) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getMaxLeftWidth(
  containerWidth: number,
  rightWidth: number,
  minLeftWidth: number,
  maxLeftWidth: number,
) {
  return Math.max(
    minLeftWidth,
    Math.min(maxLeftWidth, containerWidth - HANDLE_WIDTH * 2 - rightWidth - MIN_CENTER_WIDTH),
  );
}

function getMaxRightWidth(
  containerWidth: number,
  leftWidth: number,
  minRightWidth: number,
  maxRightWidth: number,
) {
  return Math.max(
    minRightWidth,
    Math.min(maxRightWidth, containerWidth - HANDLE_WIDTH * 2 - leftWidth - MIN_CENTER_WIDTH),
  );
}

export function WorkbenchShell({
  left,
  center,
  right,
  leftWidth,
  rightWidth,
  defaultLeftWidth,
  defaultRightWidth,
  minLeftWidth = 248,
  maxLeftWidth = 420,
  minRightWidth = 320,
  maxRightWidth = 560,
  onLeftWidthChange,
  onRightWidthChange,
}: WorkbenchShellProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!window.matchMedia("(min-width: 1024px)").matches) {
        return;
      }

      const nextContainerWidth = entry.contentRect.width;
      setContainerWidth(nextContainerWidth);
      const nextLeft = clamp(
        leftWidth,
        minLeftWidth,
        getMaxLeftWidth(nextContainerWidth, rightWidth, minLeftWidth, maxLeftWidth),
      );
      const nextRight = clamp(
        rightWidth,
        minRightWidth,
        getMaxRightWidth(nextContainerWidth, nextLeft, minRightWidth, maxRightWidth),
      );

      if (nextLeft !== leftWidth) {
        onLeftWidthChange(nextLeft);
      }

      if (nextRight !== rightWidth) {
        onRightWidthChange(nextRight);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [
    leftWidth,
    maxLeftWidth,
    maxRightWidth,
    minLeftWidth,
    minRightWidth,
    onLeftWidthChange,
    onRightWidthChange,
    rightWidth,
  ]);

  const beginResize =
    (side: "left" | "right") =>
    (event: React.MouseEvent<HTMLButtonElement> | React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      if (!containerWidth) return;
      if ("setPointerCapture" in event.currentTarget && "pointerId" in event) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // no-op
        }
      }

      const startX = event.clientX;
      const startLeftWidth = leftWidth;
      const startRightWidth = rightWidth;

      const onMove = (moveEvent: MouseEvent | PointerEvent) => {
        const delta = moveEvent.clientX - startX;

        if (side === "left") {
          const nextLeftWidth = clamp(
            startLeftWidth + delta,
            minLeftWidth,
            getMaxLeftWidth(containerWidth, startRightWidth, minLeftWidth, maxLeftWidth),
          );
          onLeftWidthChange(nextLeftWidth);
          return;
        }

        const nextRightWidth = clamp(
          startRightWidth - delta,
          minRightWidth,
          getMaxRightWidth(containerWidth, startLeftWidth, minRightWidth, maxRightWidth),
        );
        onRightWidthChange(nextRightWidth);
      };

      const stopResize = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("mousemove", onMove);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("mousemove", onMove);
        document.removeEventListener("pointerup", stopResize);
        document.removeEventListener("mouseup", stopResize);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("mouseup", stopResize);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("mousemove", onMove);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("mousemove", onMove);
      document.addEventListener("pointerup", stopResize, { once: true });
      document.addEventListener("mouseup", stopResize, { once: true });
      window.addEventListener("pointerup", stopResize, { once: true });
      window.addEventListener("mouseup", stopResize, { once: true });
    };

  return (
    <div
      ref={containerRef}
      className="grid h-full min-h-0 w-full lg:[grid-template-columns:var(--left-panel)_8px_minmax(0,1fr)_8px_var(--right-panel)]"
      style={
        {
          "--left-panel": `${leftWidth}px`,
          "--right-panel": `${rightWidth}px`,
        } as CSSProperties
      }
    >
      <div className="hidden min-h-0 min-w-0 overflow-hidden lg:block">{left}</div>
      <PanelDivider
        className="hidden lg:block"
        label="调整左侧边栏宽度"
        onDoubleClick={() => onLeftWidthChange(defaultLeftWidth)}
        onPointerDown={beginResize("left")}
      />
      <div className="min-h-0 min-w-0 overflow-hidden">{center}</div>
      <PanelDivider
        className="hidden lg:block"
        label="调整右侧证据栏宽度"
        onDoubleClick={() => onRightWidthChange(defaultRightWidth)}
        onPointerDown={beginResize("right")}
      />
      <div className="hidden min-h-0 min-w-0 overflow-hidden lg:block">{right}</div>
    </div>
  );
}
