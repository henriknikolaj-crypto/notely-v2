"use client";
import { ReactNode } from "react";

export default function TwoCol({
  left,
  children,
}: { left: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="md:flex md:gap-6">
        <aside className="w-full md:w-64 flex-shrink-0 space-y-4">{left}</aside>
        <section className="flex-1 space-y-6">{children}</section>
      </div>
    </div>
  );
}
