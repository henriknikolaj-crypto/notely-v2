// app/overblik/page.tsx
import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  archived_at: string | null;
};

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {
    // ignore – falder tilbage til DEV_USER_ID
  }
  return process.env.DEV_USER_ID ?? null;
}

export default async function OverblikPage() {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="min-h-screen bg-[#fffef9] p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
  }

  const { data, error } = await sb
    .from("folders")
    .select("id,name,parent_id,archived_at")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("Overblik folders error:", error);
  }

  const folders = (data ?? []) as FolderRow[];

  return (
    <main className="min-h-screen bg-[#fffef9]">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Dine fag</h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-600">
            Overblik over dine fag og mapper. Vælg et fag for at gå direkte til
            træning. Senere kan vi vise niveau, seneste aktivitet og små grafer
            her.
          </p>
        </header>

        {folders.length === 0 ? (
          <p className="text-sm text-zinc-600">
            Du har endnu ikke oprettet nogen mapper. Brug knappen{" "}
            <span className="font-medium">+ Ny mappe</span> i venstre side for
            at komme i gang.
          </p>
        ) : (
          <div className="space-y-4">
            {folders.map((f) => (
              <section
                key={f.id}
                className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">
                      {f.name}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      Her kan vi senere vise niveau, seneste aktivitet osv.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {/* Primær CTA: gå til træning for denne mappe */}
                    <Link
                      href={`/traener/noter?scope=${encodeURIComponent(f.id)}`}
                      className="inline-flex items-center justify-center rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-zinc-900"
                    >
                      Gå til træning
                    </Link>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
