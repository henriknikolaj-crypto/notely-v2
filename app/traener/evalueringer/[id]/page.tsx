// app/traener/evalueringer/[id]/page.tsx
import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { getCanonicalUserPlan } from "@/lib/plan/limits";
import { getTrainerSession } from "@/lib/auth/trainer-session";

export const dynamic = "force-dynamic";

function formatDT(iso: string | null | undefined) {
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

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TraenerEvalueringDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const backToParam = typeof sp.backTo === "string" ? sp.backTo : undefined;
  const scopeParam = typeof sp.scope === "string" ? sp.scope : undefined;
  const tscope = typeof sp.tscope === "string" ? sp.tscope : undefined;

  function safeBackHref(raw: string | undefined): string | null {
    const s = String(raw ?? "").trim();
    if (!s.startsWith("/") || s.startsWith("//")) return null;
    return s;
  }

  const backHref =
    safeBackHref(backToParam) ??
    (scopeParam
      ? `/traener/evalueringer/historik?scope=${encodeURIComponent(scopeParam)}`
      : tscope
      ? `/traener/evalueringer/historik?scope=${encodeURIComponent(tscope)}`
      : "/traener/evalueringer/historik");

  const sb = await supabaseServerRSC();
  const { ownerId } = await getTrainerSession();

  if (!ownerId) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-red-600">Du skal være logget ind for at se evalueringen.</p>
        <Link href={backHref} className="mt-3 inline-block text-xs text-zinc-600 hover:underline">
          ← Tilbage
        </Link>
      </main>
    );
  }

  const { data, error } = await sb
    .from("exam_sessions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    console.error("trainer evaluering detail error:", error);
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-red-600">Evaluering ikke fundet.</p>
        <Link href={backHref} className="mt-3 inline-block text-xs text-zinc-600 hover:underline">
          ← Tilbage til evalueringer
        </Link>
      </main>
    );
  }

  const planInfo = await getCanonicalUserPlan(sb, ownerId);
  if (planInfo.normalizedPlan === "freemium") {
    const { data: visibleRows, error: visibleError } = await sb
      .from("exam_sessions")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("source_type", "trainer")
      .order("created_at", { ascending: false })
      .limit(5);

    if (visibleError) {
      console.error("trainer evaluering detail visibility error:", visibleError);
      return (
        <main className="mx-auto max-w-4xl p-6">
          <p className="text-sm text-red-600">Kunne ikke validere evalueringsadgang.</p>
          <Link href={backHref} className="mt-3 inline-block text-xs text-zinc-600 hover:underline">
            ← Tilbage til evalueringer
          </Link>
        </main>
      );
    }

    const visibleIds = new Set((visibleRows ?? []).map((row: any) => String(row?.id ?? "")));
    if (!visibleIds.has(String(id))) {
      return (
        <main className="mx-auto max-w-4xl p-6">
          <p className="text-sm text-zinc-700">Denne evaluering er ikke tilgængelig på Freemium.</p>
          <Link href={backHref} className="mt-3 inline-block text-xs text-zinc-600 hover:underline">
            ← Tilbage til evalueringer
          </Link>
        </main>
      );
    }
  }

  const createdAt = (data as any).created_at as string | null | undefined;
  const score = (data as any).score as number | null | undefined;
  const question = ((data as any).question ?? "") as string;
  const answer = ((data as any).answer ?? "") as string;
  const feedback = ((data as any).feedback ?? "") as string;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <Link href={backHref} className="text-xs text-zinc-600 hover:underline">
        ← Tilbage til evalueringer
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Evaluering</h1>
          <p className="text-xs text-zinc-500">{formatDT(createdAt)}</p>
        </div>

        <div className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 shadow-sm">
          Score: <span className="font-semibold">{typeof score === "number" ? score : "—"}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">Spørgsmål</h2>
        <div className="whitespace-pre-wrap text-sm text-zinc-800">{question || "—"}</div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">Dit svar</h2>
        <div className="whitespace-pre-wrap text-sm text-zinc-800">{answer || "—"}</div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">Feedback</h2>
        <div className="prose prose-sm max-w-none whitespace-pre-wrap">{feedback || "—"}</div>
      </section>
    </main>
  );
}
