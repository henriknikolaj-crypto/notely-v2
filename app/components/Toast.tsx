"use client";

import { useEffect, useRef } from "react";

export default function Toast({
  text,
  show,
  onClose,
  duration = 2800,
}: {
  text: string;
  show: boolean;
  onClose?: () => void;
  duration?: number;
}) {
  const closeCalledRef = useRef(false);

  useEffect(() => {
    if (!show) return;

    closeCalledRef.current = false;
    const t = window.setTimeout(() => {
      if (closeCalledRef.current) return;
      closeCalledRef.current = true;
      onClose?.();
    }, Math.max(0, duration));

    return () => window.clearTimeout(t);
  }, [show, duration, onClose]);

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="rounded-xl border bg-white/90 backdrop-blur px-4 py-2 text-sm shadow">
        {text}
      </div>
    </div>
  );
}
