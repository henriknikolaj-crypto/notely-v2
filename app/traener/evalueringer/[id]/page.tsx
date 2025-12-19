// app/traener/evalueringer/[id]/page.tsx
import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {}
  return process.env.DEV_USER_ID ?? null;
}

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

  const tscope = typeof sp.tscope === "string" ? sp.tscope : undefined;

  const backParams = new URLSearchParams();
  if (tscope) backParams.set("tscope", tscope);
  const backHref = backParams.toString()
    ? `/traener/evalueringer?${backParams.toString()}`
    : "/traener/evalueringer";

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-red-600">Mangler bruger-id.</p>
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
