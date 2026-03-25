// app/notes/page.tsx
import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { filterVisibleNotes, getNoteEntitlement } from "@/lib/notes/entitlements";

export const dynamic = "force-dynamic";

type NoteRow = {
  id: string;
  title: string | null;
  content: string | null;
  source_title: string | null;
  source_url: string | null;
  created_at: string | null;
  note_type: string | null;
};

// ensartet datoformat ("16. nov. 2025, 02.37")
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

// lille helper til kort tekst
function makeSnippet(content: string | null | undefined, maxLen = 260) {
  if (!content) return "";
  const plain = content.replace(/\s+/g, " ").trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;
}

// klassificér note efter type + evt. titel-prefix
function classifyNote(
  note: Pick<NoteRow, "title" | "note_type">
): "resume" | "focus" | "feedback" | "other" {
  const type = (note.note_type ?? "").toLowerCase();
  const t = (note.title ?? "").toLowerCase();

  // 1) Primært efter note_type
  if (type === "resume") return "resume";
  if (type === "summary") return "resume";
  if (type === "focus") return "focus";
  if (
    type === "feedback" ||
    type === "trainer_feedback" || // Træner-noter gemt fra feedback
    type === "trainer"
  ) {
    return "feedback";
  }

  // 2) Fallback til gammel titel-konvention
  if (t.startsWith("resumé") || t.startsWith("resume")) return "resume";
  if (t.startsWith("fokus-noter") || t.startsWith("fokusnoter")) return "focus";
  if (t.startsWith("feedback")) return "feedback";

  return "other";
}

function isAudioGeneratedNote(note: Pick<NoteRow, "title" | "source_url">) {
  if (String(note.source_url ?? "").startsWith("notely://audio/")) return true;
  return (note.title ?? "").toLowerCase().includes("fra lyd");
}

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {}
  return null;
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="min-h-screen bg-[#fffef9]">
        <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-red-600">
          Du skal være logget ind for at åbne Noter.
        </div>
      </main>
    );
  }

  const sp = (await searchParams) || {};
  const scopeParam = typeof sp.scope === "string" ? sp.scope : undefined;
  const scope = scopeParam ?? "all";
  const showBackToNotes = scope !== "all";
  const trainerScopeParam = typeof sp.tscope === "string" ? sp.tscope : undefined;
  const trainerFolderParam = typeof sp.tfolder === "string" ? sp.tfolder : undefined;
  const topBackHref = (() => {
    if (scope !== "resume" && scope !== "focus") return "/notes";
    const params = new URLSearchParams();
    if (trainerScopeParam) params.set("scope", trainerScopeParam);
    if (trainerFolderParam) params.set("folder", trainerFolderParam);
    const qs = params.toString();
    return qs ? `/traener/noter?${qs}` : "/traener/noter";
  })();
  const listParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string" && value.trim()) listParams.set(key, value);
  }
  const currentListHref = listParams.toString() ? `/notes?${listParams.toString()}` : "/notes";
  const entitlement = await getNoteEntitlement(sb, ownerId);

  // hent alle noter for ejer (max 200 – vi viser selv max 50 pr. view)
  const { data, error } = await sb
    .from("notes")
    .select(
      "id,title,content,source_title,source_url,created_at,note_type"
    )
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("/notes query error", error);
    return (
      <main className="min-h-screen bg-[#fffef9]">
        <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-red-600">
          Kunne ikke hente noter: {error.message}
        </div>
      </main>
    );
  }

  const allNotes = filterVisibleNotes((data ?? []) as NoteRow[], entitlement);

  // filtrér efter scope
  const filteredNotes = allNotes.filter((n) => {
    const kind = classifyNote(n);

    switch (scope) {
      case "resume":
        return kind === "resume";
      case "focus":
        return kind === "focus";
      case "feedback":
        return kind === "feedback";
      case "evalueringer":
        // indtil videre samme som feedback
        return kind === "feedback";
      default:
        return true;
    }
  });

  const totalInScope = filteredNotes.length;
  const maxToShow = 50;
  const notesToShow = filteredNotes.slice(0, maxToShow);

  const headingSuffix =
    scope === "resume"
      ? " – Resuméer"
      : scope === "focus"
      ? " – Fokus-noter"
      : scope === "feedback"
      ? " – Træner-noter"
      : scope === "evalueringer"
      ? " – Evalueringer"
      : "";

  const infoLine =
    entitlement.visibleNotesLimit != null && (scope === "resume" || scope === "focus")
      ? "Viser seneste 5 på Freemium."
      : scope === "resume" || scope === "focus"
      ? totalInScope >= maxToShow
        ? "Viser de 50 nyeste noter."
        : `Viser ${totalInScope} noter.`
      : totalInScope === 0
      ? ""
      : totalInScope <= maxToShow
      ? `Viser seneste ${totalInScope} noter.`
      : `Viser seneste ${maxToShow} af ${totalInScope} noter (maks. ${maxToShow} vises her).`;

  return (
    <main className="min-h-screen bg-[#fffef9]">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {showBackToNotes && (
          <div className="mb-3">
            <Link
              href={topBackHref}
              className="text-xs text-zinc-600 hover:underline"
            >
              ← Tilbage til Noter
            </Link>
          </div>
        )}

        <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Noter{headingSuffix}</h1>
            <p className="text-xs text-zinc-600">
              Overblik over dine gemte noter på tværs af fag og mapper.
            </p>
            {infoLine && (
              <p className="mt-1 text-[11px] text-zinc-500">{infoLine}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* søgefeltet er stadig kun UI – wiring kan komme senere */}
            <input
              type="search"
              placeholder="Søg i titler, indhold og kilder..."
              className="w-56 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-zinc-900/5"
            />
            <select className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs">
              <option value="newest">Nyeste først</option>
              <option value="oldest">Ældste først</option>
            </select>
          </div>
        </header>

        {notesToShow.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Ingen noter fundet for dette view endnu.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {notesToShow.map((note) => (
              <article
                key={note.id}
                className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <div className="mb-1 text-[11px] text-zinc-400">{formatDT(note.created_at)}</div>

                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900">
                    {note.title || "Uden titel"}
                  </h2>
                  {isAudioGeneratedNote(note) ? (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      Skabt fra lyd
                    </span>
                  ) : null}
                </div>

                {note.source_title && (
                  <div className="mb-1 text-[11px] text-zinc-500">
                    Kilde: {note.source_title}
                  </div>
                )}

                <p className="mb-3 text-xs text-zinc-700">
                  {makeSnippet(note.content)}
                </p>

                <div className="mt-auto flex items-center justify-between pt-2 text-xs">
                  <a
                    href={`/notes/${note.id}?back=${encodeURIComponent(currentListHref)}`}
                    className="font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900"
                  >
                    Åbn note
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
