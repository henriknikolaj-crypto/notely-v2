// app/traener/mundtlig/MicStatusIcon.tsx
"use client";

type MicState = "idle" | "thinking" | "speaking" | "listening" | "evaluating" | "paused";

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export function MicStatusIcon({
  state,
  className,
}: {
  state: MicState;
  className?: string;
}) {
  const fillColor =
    state === "speaking"
      ? "#ef4444" // rød
      : state === "listening"
        ? "#22c55e" // grøn
        : state === "paused"
          ? "#d4d4d8" // lys grå
        : state === "evaluating"
          ? "#a1a1aa" // grå
          : state === "thinking"
            ? "#ef4444" // startfarve (animation tager over)
            : "var(--bg)"; // idle: samme som baggrund

  const pulseDark = "#b91c1c";
  const fillClass = state === "thinking" ? "mic-fill-pulse-red" : "";

  return (
    <svg
      viewBox="0 0 393 500"
      className={cx("block", className)}
      aria-hidden="true"
      style={
        {
          "--mic-fill": fillColor,
          "--mic-pulse-dark": pulseDark,
        } as React.CSSProperties
      }
    >
      {/* FYLD (kun mic-kapslen) */}
      <rect
        x="105"
        y="62"
        width="189"
        height="287"
        rx="94.5"
        ry="94.5"
        fill="var(--mic-fill)"
        className={fillClass}
      />

      {/* OUTLINE (altid sort) */}
      <g
        fill="none"
        stroke="rgb(0 0 0)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="105" y="62" width="189" height="287" rx="94.5" ry="94.5" />
        <path d="M 71 266 A 129 129 0 0 0 328 266" />
        <line x1="199.5" y1="383" x2="199.5" y2="459" />
        <line x1="134" y1="459" x2="265" y2="459" />
      </g>
    </svg>
  );
}
