// app/traener/noter/historik/page.tsx
import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { getCanonicalUserPlan } from "@/lib/plan/limits";
import { getTrainerSession } from "@/lib/auth/trainer-session";

export const dynamic = "force-dynamic";
const TRAINER_NOTE_TYPES = ["trainer_note", "trainer_eval", "trainer_feedback", "trainer", "feedback", "resume", "summary", "focus"];
type SearchParams = Record<string, string | string[] | undefined> | undefined;

function fmt(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d
    .toLocaleString("da-DK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\.$/, "");
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sb = await supabaseServerRSC();
  const { ownerId } = await getTrainerSession();
  if (!ownerId) return <p className="text-sm text-red-600">Du skal være logget ind for at se noter.</p>;
  const sp = (await searchParams) ?? {};
  const scopeParam = typeof sp.scope === "string" ? sp.scope : undefined;
  const scopeFolderIds = scopeParam
    ? scopeParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const planInfo = await getCanonicalUserPlan(sb, ownerId);
  const isFreemium = planInfo.normalizedPlan === "freemium";
  const LIMIT = isFreemium ? 5 : 50;

  let query = sb
    .from("notes")
    .select("id, title, created_at, folder_id")
    .eq("owner_id", ownerId)
    .in("note_type", TRAINER_NOTE_TYPES)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (scopeFolderIds.length > 0) {
    query = query.in("folder_id", scopeFolderIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error("noter/historik:", error);
    return <p className="text-sm text-red-600">Kunne ikke hente noter.</p>;
  }

  const notes = data ?? [];
  const backHref = scopeParam
    ? `/traener/noter?scope=${encodeURIComponent(scopeParam)}`
    : "/traener/noter";
  const listBackHref = scopeParam
    ? `/traener/noter/historik?scope=${encodeURIComponent(scopeParam)}`
    : "/traener/noter/historik";
  const shown = notes.length;
  const infoLine =
    isFreemium
      ? "Viser seneste 5 på Freemium."
      : shown >= LIMIT
      ? "Viser de 50 nyeste noter."
      : `Viser ${shown} noter.`;

  return (
    <div className="space-y-4">
      <div>
        <Link href={backHref} className="text-xs text-zinc-600 hover:underline">
          ← Tilbage til Noter
        </Link>
      </div>

      <header>
        <h2 className="text-sm font-semibold">Noter i denne mappe</h2>
        <p className="mt-1 text-sm text-slate-600">{infoLine}</p>
      </header>

      {!notes.length ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h3 className="text-sm font-medium text-zinc-900">Ingen noter endnu.</h3>
          <p className="mt-1 text-sm text-slate-600">
            Generer noter eller gem feedback i Træner for at se dem her.
          </p>
        </section>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
          {notes.map((n) => (
            <li key={n.id} className="flex items-center justify-between px-4 py-2">
              <div className="min-w-0">
                <Link
                  href={`/notes/${n.id}?back=${encodeURIComponent(listBackHref)}`}
                  className="block truncate text-sm font-medium text-zinc-900 hover:underline"
                >
                  {n.title || "Note uden titel"}
                </Link>
                <div className="text-[11px] text-zinc-500">{fmt(n.created_at)}</div>
              </div>
              <Link
                href={`/notes/${n.id}?back=${encodeURIComponent(listBackHref)}`}
                className="rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
              >
                Åbn
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
