"use client";

import * as React from "react";
import styles from "./FlipCard.module.css";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(!!mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}

const mathFriendlyFontStack =
  "Inter, 'Segoe UI', 'Segoe UI Symbol', 'Cambria Math', 'STIX Two Text', 'Noto Sans Math', system-ui, sans-serif";

type Props = {
  frontLabel?: string;
  backLabel?: string;
  front: React.ReactNode;
  back: React.ReactNode;
  flipped: boolean;
  className?: string;
};

export function FlipCard({
  frontLabel = "Spørgsmål",
  backLabel = "Svar",
  front,
  back,
  flipped,
  className = "",
}: Props) {
  const reducedMotion = usePrefersReducedMotion();

  function renderBody(content: React.ReactNode) {
    return (
      <div className="flex-1 flex items-start justify-center pt-[140px] px-10">
        <div
          className="max-w-[34ch] whitespace-pre-wrap text-center text-[15px] leading-7 text-slate-900"
          style={{ fontFamily: mathFriendlyFontStack }}
        >
          {content}
        </div>
      </div>
    );
  }

  // Reduced motion: ingen 3D flip – roligt indholdsskift
  if (reducedMotion) {
    return (
      <div className={`mx-auto w-full max-w-[420px] ${className}`}>
        <div className={`h-[600px] ${styles.shell}`}>
          <div className="h-full flex flex-col p-6">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {flipped ? backLabel : frontLabel}
            </div>

            {renderBody(flipped ? back : front)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.scene} mx-auto w-full max-w-[420px] ${className}`}>
      <div className="h-[600px]">
        <div
          className={[
            styles.card,
            styles.shell,
            flipped ? styles.flipped : "",
          ].join(" ")}
        >
          {/* FRONT */}
          <div className={`${styles.face} ${styles.front} relative p-6 flex flex-col`}>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {frontLabel}
            </div>

            {renderBody(front)}
            <div className="pointer-events-none absolute bottom-5 left-0 right-0 text-center text-[22px] text-slate-400 [font-family:var(--font-birthstone)]">
              Notely.
            </div>
          </div>

          {/* BACK */}
          <div className={`${styles.face} ${styles.back} relative p-6 flex flex-col`}>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {backLabel}
            </div>

            {renderBody(back)}
            <div className="pointer-events-none absolute bottom-5 left-0 right-0 text-center text-[22px] text-slate-400 [font-family:var(--font-birthstone)]">
              Notely.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
