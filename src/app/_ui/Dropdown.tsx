"use client";
import { useState, useRef, useEffect } from "react";

export default function Dropdown({
  trigger,
  children,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        className="px-3 py-1.5 rounded-md border hover:bg-gray-50"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {trigger}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded-md border bg-white shadow-sm z-20">
          <div className="p-1">{children}</div>
        </div>
      )}
    </div>
  );
}