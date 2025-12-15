"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Folder = { id: string; name: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function AppShell({
  children,
  folders,
  sidebarFooter,
}: {
  children: React.ReactNode;
  folders: Folder[];
  /** Sektion-specifikt felt nederst i venstre kolonne (Træner/Noter/Mc/…) */
  sidebarFooter?: React.ReactNode;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();

  const currentFolderId = sp.get("folder_id") || "";

  const tabs = useMemo(
    () => [
      { label: "Noter", href: "/app/noter", pro: false },
      { label: "Multiple Choice", href: "/app/mc", pro: false },
      { label: "Flashcards", href: "/app/flashcards", pro: false },
      { label: "Træner", href: "/app/traener", pro: true },
      { label: "Simulator", href: "/app/simulator", pro: true },
    ],
    []
  );

  function withFolder(href: string) {
    if (!currentFolderId) return href;
    const url = new URL(href, "http://x");
    url.searchParams.set("folder_id", currentFolderId);
    return url.pathname + "?" + url.searchParams.toString();
  }

  function currentWithFolder(id: string) {
    const params = new URLSearchParams(Array.from(sp.entries()));
    if (id) params.set("folder_id", id);
    else params.delete("folder_id");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname || "/app";
  }

  return (
    <div className="min-h-screen bg-[#fffef9] text-black">
      <div className="mx-auto max-w-screen-2xl px-3 py-4">
        <div className="grid grid-cols-12 gap-4">
          {/* VENSTRE KOLONNE */}
          <aside className="col-span-12 space-y-3 md:col-span-3 lg:col-span-2">
            {/* Overblik / Konto – egen boks */}
            <div className="rounded-2xl border border-black/10 bg-white shadow-sm">
              <div className="border-b border-black/10 px-4 py-3">
                <div className="text-sm font-semibold">Overblik</div>
              </div>
              <nav className="p-2 text-sm">
                <Link
                  href={withFolder("/app")}
                  className={cn(
                    "block rounded-lg px-3 py-2 hover:bg-neutral-100",
                    pathname === "/app" && "bg-neutral-100"
                  )}
                >
                  Dashboard
                </Link>
                <div className="my-2 h-[1px] bg-black/10" />
                <Link
                  href={withFolder("/app/konto")}
                  className={cn(
                    "block rounded-lg px-3 py-2 hover:bg-neutral-100",
                    pathname?.startsWith("/app/konto") && "bg-neutral-100"
                  )}
                >
                  Konto
                </Link>
              </nav>
            </div>

            {/* Mapper – egen boks */}
            <div className="rounded-2xl border border-black/10 bg-white shadow-sm">
              <div className="border-b border-black/10 px-4 py-3">
                <div className="text-sm font-semibold">Mapper</div>
              </div>
              <ul className="p-2 text-sm">
                {(folders || []).map((f) => {
                  const active = f.id === currentFolderId;
                  return (
                    <li key={f.id} className="mb-1 last:mb-0">
                      <Link
                        href={currentWithFolder(f.id)}
                        className={cn(
                          "block rounded-lg border px-3 py-2",
                          active
                            ? "border-black bg-black text-white"
                            : "border-black/15 bg-white text-black hover:bg-neutral-100"
                        )}
                      >
                        {f.name}
                      </Link>
                    </li>
                  );
                })}
                {(!folders || folders.length === 0) && (
                  <li className="px-3 py-2 text-black/50">
                    Ingen mapper endnu.
                  </li>
                )}
              </ul>
            </div>

            {/* Nederste felt – specifikt for hver træningsside */}
            {sidebarFooter && (
              <div className="rounded-2xl border border-black/10 bg-white shadow-sm">
                {sidebarFooter}
              </div>
            )}
          </aside>

          {/* HØJRE: topbar + main */}
          <div className="col-span-12 md:col-span-9 lg:col-span-10">
            <div className="mb-4 rounded-2xl border border-black/10 bg-white shadow-sm">
              <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
                {tabs.map((t) => {
                  const active = pathname?.startsWith(t.href);
                  return (
                    <Link
                      key={t.href}
                      href={withFolder(t.href)}
                      className={cn(
                        "whitespace-nowrap rounded-lg border px-3 py-2 text-sm",
                        active
                          ? "border-black bg-black text-white"
                          : "border-black/15 bg-white text-black hover:bg-neutral-100"
                      )}
                    >
                      {t.label}
                      {t.pro && (
                        <span
                          className={
                            "ml-2 rounded border px-1 py-[1px] text-[11px] " +
                            (active ? "border-white/50" : "border-black/20")
                          }
                        >
                          Pro
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>

            <main>{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}
