"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type DesktopSidebarShellProps = {
  sidebar: ReactNode;
  mobileTop?: ReactNode;
  desktopTop?: ReactNode;
  children: ReactNode;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const STORAGE_KEY = "notely:trainer-desktop-sidebar";
const DEFAULT_WIDTH = 256;
const MAX_WIDTH = 336;
const COLLAPSED_WIDTH = 28;
const COLLAPSED_RAIL_WIDTH = 40;
const COLLAPSE_THRESHOLD = 116;
const FALLBACK_PENCIL_HEIGHT = 320;
const PENCIL_WIDTH = 14;
const PENCIL_TIP_HEIGHT = 30;
const PENCIL_CAP_HEIGHT = 16;
const PENCIL_MARKER_HEIGHT = 4;

function clampWidth(width: number) {
  return Math.min(MAX_WIDTH, Math.max(COLLAPSED_WIDTH, Math.round(width)));
}

export default function DesktopSidebarShell({
  sidebar,
  mobileTop,
  desktopTop,
  children,
}: DesktopSidebarShellProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const sidebarContentRef = useRef<HTMLDivElement | null>(null);
  const lastExpandedWidthRef = useRef(DEFAULT_WIDTH);
  const hydratedRef = useRef(false);

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [measuredStandardSidebarHeight, setMeasuredStandardSidebarHeight] = useState(0);
  const [availableCollapsedHeight, setAvailableCollapsedHeight] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        hydratedRef.current = true;
        return;
      }

      const parsed = JSON.parse(raw) as {
        width?: number;
        collapsed?: boolean;
      };

      const storedWidth = Number.isFinite(parsed?.width) ? clampWidth(parsed.width as number) : DEFAULT_WIDTH;
      const nextCollapsed = Boolean(parsed?.collapsed);
      const nextExpandedWidth = storedWidth > COLLAPSE_THRESHOLD ? storedWidth : DEFAULT_WIDTH;

      lastExpandedWidthRef.current = nextExpandedWidth;
      setCollapsed(nextCollapsed);
      setSidebarWidth(nextCollapsed ? COLLAPSED_WIDTH : nextExpandedWidth);
    } catch {
      setCollapsed(false);
      setSidebarWidth(DEFAULT_WIDTH);
      lastExpandedWidthRef.current = DEFAULT_WIDTH;
    } finally {
      hydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") return;

    const widthToStore = collapsed ? lastExpandedWidthRef.current : sidebarWidth;

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        width: clampWidth(widthToStore),
        collapsed,
      }),
    );
  }, [collapsed, sidebarWidth]);

  useEffect(() => {
    if (collapsed) return;
    lastExpandedWidthRef.current = sidebarWidth;
  }, [collapsed, sidebarWidth]);

  useEffect(() => {
    if (collapsed || !sidebarContentRef.current || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const nextHeight = Math.round(entries[0]?.contentRect.height ?? 0);
      const isStandardWidth = Math.abs(sidebarWidth - DEFAULT_WIDTH) <= 1;
      if (nextHeight > 0 && isStandardWidth) {
        setMeasuredStandardSidebarHeight(nextHeight);
      }
    });

    observer.observe(sidebarContentRef.current);
    return () => observer.disconnect();
  }, [collapsed, sidebarWidth]);

  useEffect(() => {
    if (!shellRef.current || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const nextHeight = Math.round(entries[0]?.contentRect.height ?? 0);
      if (nextHeight > 0) {
        setAvailableCollapsedHeight(nextHeight);
      }
    });

    observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, []);

  function updateSidebarWidth(clientX: number) {
    const shellBounds = shellRef.current?.getBoundingClientRect();
    if (!shellBounds) return;

    const rawWidth = clampWidth(clientX - shellBounds.left);

    if (rawWidth <= COLLAPSE_THRESHOLD) {
      setCollapsed(true);
      setSidebarWidth(COLLAPSED_WIDTH);
      return;
    }

    setCollapsed(false);
    setSidebarWidth(rawWidth);
  }

  function handleResizeStart(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.preventDefault();
    setIsDragging(true);
    updateSidebarWidth(event.clientX);

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateSidebarWidth(moveEvent.clientX);
    };

    const stopDragging = () => {
      document.body.style.userSelect = previousUserSelect;
      setIsDragging(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
  }

  function expandSidebar() {
    const nextWidth = clampWidth(DEFAULT_WIDTH);
    lastExpandedWidthRef.current = nextWidth;
    setCollapsed(false);
    setSidebarWidth(nextWidth);
  }

  const minimumPencilHeight = PENCIL_CAP_HEIGHT + PENCIL_MARKER_HEIGHT * 3 + PENCIL_TIP_HEIGHT;
  const pencilMaxHeight = measuredStandardSidebarHeight || FALLBACK_PENCIL_HEIGHT;
  const effectivePencilHeight = Math.min(availableCollapsedHeight || pencilMaxHeight, pencilMaxHeight);
  const pencilHeight = Math.max(minimumPencilHeight, effectivePencilHeight);

  const railWidth = collapsed ? COLLAPSED_RAIL_WIDTH : sidebarWidth;

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    console.debug("[DesktopSidebarShell]", {
      measuredStandardSidebarHeight,
      availableCollapsedHeight,
      finalPencilHeight: pencilHeight,
    });
  }, [availableCollapsedHeight, measuredStandardSidebarHeight, pencilHeight]);

  return (
    <div ref={shellRef} className="md:flex md:items-start md:gap-6">
      <div
        className={cn(
          "hidden md:block",
          isDragging ? "select-none transition-none" : "transition-[width] duration-200 ease-out",
        )}
        style={{ width: `${railWidth}px` }}
      >
        <aside
          className={cn(
            "relative shrink-0",
            collapsed ? "overflow-visible" : "",
          )}
        >
          {collapsed ? (
            <div className="flex justify-end pr-1">
              <button
                type="button"
                onClick={expandSidebar}
                className="relative w-[20px] opacity-95 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
                style={{ height: `${pencilHeight}px` }}
                aria-label="Udvid venstre sidebar"
                title="Udvid sidebar"
              >
                <span aria-hidden="true" className="flex h-full w-full flex-col items-center">
                  <span
                    className="block border-[1.5px] border-b-0 border-zinc-900 bg-white"
                    style={{
                      width: `${PENCIL_WIDTH}px`,
                      height: `${PENCIL_CAP_HEIGHT}px`,
                      borderTopLeftRadius: "5px",
                      borderTopRightRadius: "5px",
                    }}
                  />
                  <span
                    className="block border-x-[1.5px] border-b-[1.5px] border-zinc-900 bg-white"
                    style={{ width: `${PENCIL_WIDTH}px`, height: `${PENCIL_MARKER_HEIGHT}px` }}
                  />
                  <span
                    className="block border-x-[1.5px] border-b-[1.5px] border-zinc-900 bg-white"
                    style={{ width: `${PENCIL_WIDTH}px`, height: `${PENCIL_MARKER_HEIGHT}px` }}
                  />
                  <span
                    className="block border-x-[1.5px] border-b-[1.5px] border-zinc-900 bg-white"
                    style={{ width: `${PENCIL_WIDTH}px`, height: `${PENCIL_MARKER_HEIGHT}px` }}
                  />
                  <span
                    className="relative block min-h-0 flex-1 border-x-[1.5px] border-zinc-900 bg-white"
                    style={{ width: `${PENCIL_WIDTH}px` }}
                  >
                    <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-900" />
                  </span>
                  <span
                    className="relative block"
                    style={{ width: `${PENCIL_WIDTH}px`, height: `${PENCIL_TIP_HEIGHT}px` }}
                  >
                    <span
                      className="absolute inset-0 bg-zinc-900"
                      style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
                    />
                    <span
                      className="absolute left-[1.5px] right-[1.5px] top-[1.5px] bottom-[1.5px] bg-white"
                      style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
                    />
                    <span
                      className="absolute bottom-[1.5px] left-1/2 w-[6px] -translate-x-1/2 bg-zinc-900"
                      style={{
                        height: "14px",
                        clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                      }}
                    />
                  </span>
                </span>
              </button>
            </div>
          ) : (
            <div ref={sidebarContentRef} className="relative space-y-3 rounded-2xl border border-zinc-200 bg-white p-3 text-sm shadow-sm">
              {sidebar}

              <button
                type="button"
                onPointerDown={handleResizeStart}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setCollapsed(true);
                  setSidebarWidth(COLLAPSED_WIDTH);
                }}
                className="absolute right-[-7px] top-1/2 h-14 w-[14px] -translate-y-1/2 cursor-ew-resize bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
                aria-label="Træk for at ændre sidebar-bredden"
                title="Træk for at ændre sidebar-bredden"
              >
                <span aria-hidden="true" className="pointer-events-none absolute left-[5px] top-1/2 h-6 w-px -translate-y-1/2 bg-zinc-400" />
                <span aria-hidden="true" className="pointer-events-none absolute left-[9px] top-1/2 h-6 w-px -translate-y-1/2 bg-zinc-400" />
              </button>
            </div>
          )}
        </aside>
      </div>

      <section className="min-w-0 flex-1 bg-transparent">
        <div
          className={cn(
            "w-full max-w-3xl",
            collapsed ? "mx-auto md:mx-0 md:ml-3 md:mr-auto md:w-auto md:max-w-none" : "mx-auto",
          )}
        >
          <div className="md:hidden">{mobileTop}</div>
          <div className="hidden md:block">{desktopTop}</div>
          {children}
        </div>
      </section>
    </div>
  );
}
