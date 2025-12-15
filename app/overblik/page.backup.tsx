import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

type Folder = { id: string; name: string; created_at?: string | null };

function colorFor(score: number | null) {
  if (score === null) return "#d1d5db";    // grå (ingen data)
  if (score < 50) return "#ef4444";        // rød
  if (score < 75) return "#f59e0b";        // gul
  return "#22c55e";                         // grøn
}

/** recency-weighted mean: weight = exp(-ageDays/14) */
function readinessFromSessions(rows: { score: number | null; created_at: string }[]): { score: number | null; n: number } {
  const now = Date.now();
  let sum = 0;
  let wsum = 0;
  let n = 0;
  for (const r of rows) {
    const s = Number.isFinite(r.score as number) ? Math.max(0, Math.min(100, Number(r.score))) : null;
    if (s === null) continue;
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const ageDays = Math.max(0, (now - t) / 86400000);
    const w = Math.exp(-ageDays / 14);
    sum += s * w;
    wsum += w;
    n++;
  }
  if (n < 3 || wsum <= 0) return { score: null, n }; // show “ingen data” < 3 målinger
  return { score: Math.round(sum / wsum), n };
}

async function getOwnerId(sb: Awaited<ReturnType<typeof supabaseServerRSC>>) {
  try {
    const { data } = await sb.auth.getUser();
    return data.user?.id ?? process.env.DEV_USER_ID ?? null;
  } catch {
    return process.env.DEV_USER_ID ?? null;
  }
}

export default async function OverblikPage() {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);
  if (!ownerId) {
    return <main className="max-w-5xl mx-auto p-6">Ingen DEV_USER_ID / bruger-session.</main>;
  }

  // 1) Hent mapper
  const { data: folders } = await sb
    .from("note_folders")
    .select("id,name,created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });

  // 2) Noter pr. mappe
  const noteCounts = new Map<string, number>();
  if (folders?.length) {
    for (const f of folders) {
      const { count } = await sb
        .from("notes")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("folder_id", f.id);
      noteCounts.set(f.id, count ?? 0);
    }
  }

  // 3) exam_sessions — tåler både folder_id og selected_folder_id
  type Row = { folder_id?: string | null; selected_folder_id?: string | null; score: number | null; created_at: string };
  let sessions: Row[] = [];
  try {
    const { data } = await sb
      .from("exam_sessions")
      .select("folder_id, selected_folder_id, score, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(1000);
    sessions = (data ?? []) as Row[];
  } catch {
    sessions = [];
  }

  // 4) Gruppér og beregn readiness
  const byFolder = new Map<string, { score: number | null; n: number }>();
  if (sessions.length) {
    const map = new Map<string, { score: number | null; created_at: string }[]>();
    for (const s of sessions) {
      const key = s.folder_id ?? s.selected_folder_id ?? "null";
      const arr = map.get(key) ?? [];
      arr.push({ score: s.score, created_at: s.created_at });
      map.set(key, arr);
    }
    for (const [fid, arr] of map) {
      byFolder.set(fid, readinessFromSessions(arr));
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-semibold mb-1">Overblik</h1>
      <p className="text-sm opacity-70 mb-6">Dine fag samlet ét sted – klik Træn for at vælge øvelse.</p>

      <div className="grid gap-5 md:grid-cols-2">
        {(folders ?? []).map((f: Folder) => {
          const r = byFolder.get(f.id) ?? { score: null, n: 0 };
          const color = colorFor(r.score);
          const notes = noteCounts.get(f.id) ?? 0;

          return (
            <section key={f.id} className="rounded-2xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{f.name}</h2>
                {r.score === null ? (
                  <span className="text-xs opacity-60">ingen data</span>
                ) : (
                  <span className="text-xs opacity-70">{r.score}% <span className="opacity-50">(af {r.n})</span></span>
                )}
              </div>

              {/* tydelig track (altid synlig) */}
              <div className="mt-3 h-3 rounded-full bg-[#e5e7eb] border border-[#d1d5db]">
                <div
                  className="h-3 rounded-full transition-all"
                  style={{ width: `${r.score ?? 0}%`, background: color }}
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-[#e5e7eb] py-3">
                  <div className="text-xl font-semibold">—</div>
                  <div className="text-xs opacity-70">DAGE</div>
                </div>
                <div className="rounded-xl border border-[#e5e7eb] py-3">
                  <div className="text-xl font-semibold">{notes}</div>
                  <div className="text-xs opacity-70">NOTER</div>
                </div>
                <div className="rounded-xl border border-[#e5e7eb] py-3">
                  <div className="text-xl font-semibold">0</div>
                  <div className="text-xs opacity-70">KORT</div>
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                <Link
                  href={`/traen?folder_id=${f.id}`}
                  className="rounded-lg border border-[#e5e7eb] bg-white px-4 py-2 text-sm hover:shadow-sm"
                >
                  Træn
                </Link>
              </div>
            </section>
          );
        })}

        {(folders ?? []).length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#e5e7eb] bg-white p-8 text-center text-[#6b7280]">
            Ingen mapper endnu. Opret en under “Mapper (administration)” eller importér nogle noter.
          </div>
        )}
      </div>
    </main>
  );
}



