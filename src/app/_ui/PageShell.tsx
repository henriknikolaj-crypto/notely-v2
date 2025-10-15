import type { ReactNode } from "react";
import AppShell from "@/app/_ui/AppShell";

export default function PageShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell>
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {actions}
      </header>
      {children}
    </AppShell>
  );
}
