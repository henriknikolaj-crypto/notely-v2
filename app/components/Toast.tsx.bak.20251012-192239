"use client";
import { useEffect, useState } from "react";

export default function Toast({ text, show, onClose, duration = 2800 }: {
  text: string;
  show: boolean;
  onClose?: () => void;
  duration?: number;
}) {
  const [visible, setVisible] = useState(show);
  useEffect(() => {
    setVisible(show);
    if (show) {
      const t = setTimeout(() => {
        setVisible(false);
        onClose?.();
      }, duration);
      return () => clearTimeout(t);
    }
  }, [show, duration, onClose]);
  if (!visible) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="rounded-xl border bg-white/90 backdrop-blur px-4 py-2 text-sm shadow">
        {text}
      </div>
    </div>
  );
}
