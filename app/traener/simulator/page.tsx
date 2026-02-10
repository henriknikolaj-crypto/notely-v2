import "server-only";

import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ClientWrittenExam from "./ClientWrittenExam";

export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // DEV fallback
  }
  return process.env.DEV_USER_ID ?? null;
}

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function pickString(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? "";
  return "";
}

function buildHref(
  basePath: string,
  sp: Record<string, string | string[] | undefined>,
  patch: Record<string, string>,
) {
  const params = new URLSearchParams();

  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v.trim()) params.set(k, v);
    else if (Array.isArray(v) && v.length) params.set(k, v.join(","));
  }

  for (const [k, v] of Object.entries(patch)) params.set(k, v);

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};

  const modeRaw = pickString(sp, "mode").toLowerCase();
  const mode: "skrift" | "mundtlig" = modeRaw === "mundtlig" ? "mundtlig" : "skrift";

  const activeFolderId = pickString(sp, "folder") || null;

  const scopeRaw = pickString(sp, "scope");
  const scopeIds = scopeRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
  }

  const scopeLabel = (() => {
    if (scopeIds.length > 1) return `Eksamen vil bruge ${scopeIds.length} valgte mapper som grundlag.`;
    if (scopeIds.length === 1) return "Eksamen vil bruge 1 valgt mappe som grundlag.";
    if (activeFolderId) return "Eksamen vil tage udgangspunkt i den mappe du har valgt i venstre side.";
    return "Vælg mapper i venstre side for at bestemme hvad eksamensforløbet skal dække.";
  })();

  const basePath = "/traener/simulator";
  const hrefSkrift = buildHref(basePath, sp, { mode: "skrift" });
  const hrefMundtlig = buildHref(basePath, sp, { mode: "mundtlig" });

  return (
    <main>
      <header>
        <h1 className="text-lg font-semibold text-zinc-900">Eksamen</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          Tidsbegrænsede eksamensforløb med flere spørgsmål i træk – samme følelse som en rigtig prøve.
        </p>
        <div className="mt-3 h-px w-full bg-zinc-200" />
      </header>

      <section className="mt-2 space-y-4">
        {/* ✅ Skrift/Mundtlig toggle (grå, sort tekst) */}
        <div className="inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
  <Link
    href={hrefSkrift}
    className={cx(
      "px-4 py-2 text-sm text-zinc-900",
      mode === "skrift" ? "bg-zinc-200 text-zinc-900" : "bg-white text-zinc-900 hover:bg-zinc-50"
    )}
  >
    Skrift
  </Link>

  <Link
    href={hrefMundtlig}
    className={cx(
      "border-l border-zinc-200 px-4 py-2 text-sm text-zinc-900",
      mode === "mundtlig" ? "bg-zinc-200" : "bg-white hover:opacity-90",
    )}
  >
    Mundtlig
  </Link>
</div>

        {mode === "mundtlig" ? (
          <>
            <p className="text-sm text-zinc-600">Mundtlig eksamen er på vej. (V1: fokus på Skrift)</p>
            <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold">Mundtlig</h2>
              <p className="text-xs text-zinc-600">Spørgsmål + svar (kommer snart)</p>
            </section>
          </>
        ) : (
          <>
            <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold">Træningsområde</h2>
              <p className="text-xs text-zinc-600">{scopeLabel}</p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Vi bruger de mapper du vælger i venstre side – ligesom i Træner, Multiple Choice og Flashcards.
              </p>
            </section>

            <ClientWrittenExam scopeFolderIds={scopeIds} activeFolderId={activeFolderId} />
          </>
        )}
      </section>
    </main>
  );
}
