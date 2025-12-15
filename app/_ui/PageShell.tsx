// app/_ui/PageShell.tsx
import "server-only";
import React from "react";

type Props = {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function PageShell({ title, description, children, className }: Props) {
  return (
    <main className={cn("mx-auto w-full max-w-6xl px-4 py-6 md:px-6", className)}>
      {(title || description) && (
        <header className="mb-6 border-b border-zinc-200 pb-3">
          {title && <h1 className="text-lg font-semibold text-zinc-900">{title}</h1>}
          {description && <p className="mt-1 text-sm text-zinc-600">{description}</p>}
        </header>
      )}
      <div className="space-y-6">{children}</div>
    </main>
  );
}
