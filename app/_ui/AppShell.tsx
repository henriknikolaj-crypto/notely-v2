import * as React from "react";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#fffef9] text-black">
      <div className="mx-auto max-w-5xl px-4 py-6">{children}</div>
    </div>
  );
}
