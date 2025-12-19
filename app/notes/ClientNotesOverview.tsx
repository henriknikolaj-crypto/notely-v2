"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Scope = "all" | "summary" | "focus";

type NoteCard = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  snippet: string;
};

// Ensartet datoformat: "16. nov. 2025, 02.37"
function formatDT(iso: string | null | undefined) {
  if (!iso) return "";

  const d = new Date(iso);

  const trimDot = (s: string) => s.replace(/\.$/, "");

  const dayRaw = d.toLocaleString("da-DK", { day: "2-digit" });
  const monRaw = d.toLocaleString("da-DK", { month: "short" });
  const yr = d.toLocaleString("da-DK", { year: "numeric" });
  const hm = d.toLocaleString("da-DK", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const day = trimDot(dayRaw);
  const mon = trimDot(monRaw);

  return `${day}. ${mon}. ${yr}, ${hm}`;
}

export default function ClientNotesOverview(props: {
  notes: NoteCard[];
  scope?: Scope;
}) {
  const { notes, scope = "all" } = props;

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  const heading =
    scope === "summary"
      ? "Resuméer"
      : scope === "focus"
      ? "Fokus-noter"
      : "Noter";

  const subheading =
    scope === "summary"
      ? "Overblik over dine resuméer på tværs af fag og mapper."
      : scope === "focus"
      ? "Overblik over dine fokus-noter med eksamensvinkler."
      : "Overblik over dine gemte noter på tværs af fag og mapper.";

  const filtered = useMemo(() => {
    let list = notes;

    // Ekstra sikkerhed: filtrer også på klienten efter titel
    if (scope === "summary") {
      list = list.filter((n) =>
        n.title.toLowerCase().startsWith("resumé")
      );
    } else if (scope === "focus") {
      list = list.filter((n) =>
        n.title.toLowerCase().startsWith("fokus-noter")
      );
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((n) => {
        const inTitle = n.title.toLowerCase().includes(q);
        const inSource = (n.sourceTitle ?? "").toLowerCase().includes(q);
        const inSnippet = n.snippet.toLowerCase().includes(q);
        return inTitle || inSource || inSnippet;
      });
    }

    const sorted = [...list].sort((a, b) => {
      const at = new Date(a.createdAt).getTime();
      const bt = new Date(b.createdAt).getTime();
      return sort === "newest" ? bt - at : at - bt;
    });

    return sorted;
  }, [notes, query, sort, scope]);

  const hasResults = filtered.length > 0;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">
            {heading}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">{subheading}</p>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            type="search"
            placeholder="Søg i titler, indhold og kilder…"
            className="w-full min-w-[220px] rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none ring-0 placeholder:text-neutral-400 focus:border-neutral-400 md:w-64"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
            value={sort}
            onChange={(e) =>
              setSort(e.target.value === "oldest" ? "oldest" : "newest")
            }
          >
            <option value="newest">Nyeste først</option>
            <option value="oldest">Ældste først</option>
          </select>
        </div>
      </div>

      {!hasResults ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-sm text-neutral-600">
          Ingen noter matcher din søgning endnu.
          <br />
          Gem feedback eller kontekst fra Træner / Eksamen for at se dem
          her.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((n) => (
            <article
              key={n.id}
              className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium text-neutral-900">
                    {n.title}
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    Kilde:{" "}
                    {n.sourceUrl ? (
                      <Link
                        href={n.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        {n.sourceTitle ?? n.sourceUrl}
                      </Link>
                    ) : (
                      n.sourceTitle ?? "–"
                    )}
                  </p>
                </div>
                <p className="shrink-0 text-right text-[11px] leading-snug text-neutral-400">
                  {formatDT(n.createdAt)}
                </p>
              </header>

              <p className="mt-3 line-clamp-4 text-sm text-neutral-700 whitespace-pre-line">
                {n.snippet}
              </p>

              <footer className="mt-3 flex items-center justify-between text-xs">
                <Link
                  className="font-medium text-neutral-900 underline-offset-2 hover:underline"
                  href={`/notes/${n.id}`}
                >
                  Åbn note
                </Link>
                <span className="text-neutral-400">
                  ID:{" "}
                  <span className="font-mono text-[10px]">
                    {n.id.slice(0, 8)}…
                  </span>
                </span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
