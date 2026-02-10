import "server-only";

import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ClientOralExam from "./ClientOralExam";

export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // ignore - fallback below
  }
  return process.env.DEV_USER_ID ?? null;
}

function pickString(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? "";
  return "";
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const activeFolderId = pickString(sp, "folder") || null;

  const scopeRaw = pickString(sp, "scope");
  const scopeFolderIds = scopeRaw
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
    if (scopeFolderIds.length > 1) return `Mundtlig aflevering bruger ${scopeFolderIds.length} valgte mapper.`;
    if (scopeFolderIds.length === 1) return "Mundtlig aflevering bruger 1 valgt mappe.";
    if (activeFolderId) return "Mundtlig aflevering bruger den mappe du har valgt i venstre side.";
    return "Vælg mapper i venstre side for at styre hvilket pensum evalueringen skal bruge.";
  })();

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-zinc-900">Mundtlig eksamen</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          Optag dit svar, aflever, og få karakter + feedback baseret på afskriften.
        </p>
        <div className="mt-3 h-px w-full bg-zinc-200" />
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold">Træningsområde</h2>
        <p className="text-xs text-zinc-600">{scopeLabel}</p>
      </section>

      <ClientOralExam scopeFolderIds={scopeFolderIds} activeFolderId={activeFolderId} />
    </main>
  );
}
