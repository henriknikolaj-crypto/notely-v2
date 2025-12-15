// app/traener/noter/historik/page.tsx
import "server-only";
import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) return data.user.id as string;
  } catch {}
  return process.env.DEV_USER_ID ?? null;
}

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

export default async function Page() {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);
  if (!ownerId) return <p className="text-sm text-red-600">Mangler bruger-id.</p>;

  const { data, error } = await sb
    .from("notes")
    .select("id, title, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("noter/historik:", error);
    return <p className="text-sm text-red-600">Kunne ikke hente noter.</p>;
  }

  const notes = data ?? [];

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold">Træner-noter (maks. 50)</h2>
        <p className="mt-1 text-sm text-slate-600">Noter gemt fra Træner/øvelser. Klik for at åbne.</p>
      </header>

      {!notes.length ? (
        <p className="text-sm text-slate-600">Ingen noter endnu.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
          {notes.map((n) => (
            <li key={n.id} className="flex items-center justify-between px-4 py-2">
              <div className="min-w-0">
                <Link
                  href={`/notes/${n.id}`}
                  className="block truncate text-sm font-medium text-zinc-900 hover:underline"
                >
                  {n.title || "Note uden titel"}
                </Link>
                <div className="text-[11px] text-zinc-500">{fmt(n.created_at)}</div>
              </div>
              <Link
                href={`/notes/${n.id}`}
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



