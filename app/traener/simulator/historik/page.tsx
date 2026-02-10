// app/traener/simulator/historik/page.tsx
import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "skrift" | "mundtlig";
type SP = Record<string, string | string[] | undefined>;

function normMode(raw: unknown): Mode {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "mundtlig" ? "mundtlig" : "skrift";
}

function sourceTypesForMode(mode: Mode) {
  return mode === "mundtlig"
    ? ["mundtlig", "oral", "simulator_oral", "exam_oral", "mundtlig_simulator"]
    : ["simulator", "skrift", "written", "exam_simulator", "skrift_simulator"];
}

function formatDT(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d
    .toLocaleString("da-DK", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\.$/, "");
}

function formatScore(score: number | null) {
  if (score == null) return "–";
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return `${s}%`;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
    .filter(Boolean);
}

function readMetaFolderIds(meta: any): string[] {
  if (!meta || typeof meta !== "object") return [];
  const raw = (meta as any).folder_ids ?? (meta as any).folderIds ?? (meta as any).scopeFolderIds;
  return normalizeStringArray(raw);
}

function compactFolderLabel(folderIds: string[], folderMap: Map<string, string>): string | null {
  const ids = Array.isArray(folderIds) ? folderIds.filter(Boolean) : [];
  if (ids.length === 0) return null;

  const names = ids.map((id) => folderMap.get(id)).filter((x): x is string => !!x);
  if (names.length > 0) {
    const first = names[0];
    const extra = ids.length - 1;
    return extra > 0 ? `${first} +${extra}` : first;
  }

  if (ids.length > 1) return `${ids.length} mapper`;
  return "Ukendt mappe";
}

function buildHref(path: string, sp: URLSearchParams, patch: Record<string, string | null | undefined>) {
  const p = new URLSearchParams(sp.toString());
  for (const [k, v] of Object.entries(patch)) {
    const vv = String(v ?? "").trim();
    if (!vv) p.delete(k);
    else p.set(k, vv);
  }
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

function toUrlSearchParams(obj: SP) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (Array.isArray(v)) sp.set(k, v[0] ?? "");
    else sp.set(k, v);
  }
  return sp;
}

export default async function Page(props: { searchParams: Promise<SP> }) {
  const spObj = await props.searchParams;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const cookieStore = await cookies();

  const sb = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Best-effort (kan fejle i visse Server Component contexts – så ignorerer vi)
        try {
          for (const c of cookiesToSet) cookieStore.set(c.name, c.value, c.options);
        } catch {}
      },
    },
  });

  const { data: userData } = await sb.auth.getUser();
  const ownerId = userData?.user?.id;
  if (!ownerId) redirect("/auth/login");

  const mode = normMode(spObj.mode);
  const wantedTypes = sourceTypesForMode(mode);

  const sp = toUrlSearchParams(spObj);
  const baseSp = new URLSearchParams(sp.toString());
  baseSp.delete("mode");

  const backHref =
    mode === "mundtlig"
      ? buildHref("/traener/mundtlig", baseSp, {})
      : buildHref("/traener/simulator", baseSp, {});

  type Row = { id: string; created_at: string | null; score: number | null; folder_id: string | null; meta?: any };

  const run = async (withSourceType: boolean) => {
    const baseCount = sb
      .from("exam_sessions")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId);

    const baseRows = sb
      .from("exam_sessions")
      .select("id, created_at, score, folder_id, meta")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(50);

    const countQ = withSourceType ? baseCount.in("source_type", wantedTypes) : baseCount;
    const rowsQ = withSourceType ? baseRows.in("source_type", wantedTypes) : baseRows;

    const c = await countQ;
    if (c.error) return { ok: false as const, error: c.error };

    const r = await rowsQ;
    if (r.error) return { ok: false as const, error: r.error };

    const total = typeof c.count === "number" ? Math.min(c.count, 50) : null;
    const rows = (Array.isArray(r.data) ? r.data : []) as Row[];

    return { ok: true as const, total, rows };
  };

  // Prøv med source_type-filter først; hvis kolonnen ikke findes, fallback uden filter.
  let total: number | null = null;
  let rows: Row[] = [];

  const first = await run(true);
  if (first.ok) {
    total = first.total;
    rows = first.rows;
  } else {
    const msg = String(first.error?.message ?? "");
    if (msg.includes('column "source_type"') && msg.includes("does not exist")) {
      const fb = await run(false);
      if (fb.ok) {
        total = fb.total;
        rows = fb.rows;
      } else {
        rows = [];
        total = 0;
      }
    } else {
      rows = [];
      total = 0;
    }
  }

  // Folder names (best-effort, uden relation/join)
  const folderIds = new Set<string>();

  for (const r of rows) {
    if (r.folder_id) folderIds.add(r.folder_id);
    const metaIds = readMetaFolderIds(r.meta);
    for (const id of metaIds) folderIds.add(id);
  }

  const folderMap = new Map<string, string>();

  if (folderIds.size) {
    const fr = await sb
      .from("folders")
      .select("id, name")
      .eq("owner_id", ownerId)
      .in("id", Array.from(folderIds));
    if (!fr.error && Array.isArray(fr.data)) {
      for (const f of fr.data as any[]) {
        if (f?.id && f?.name) folderMap.set(String(f.id), String(f.name));
      }
    }
  }

  const title = mode === "mundtlig" ? "Mundtlig-historik" : "Skrift-historik";
  const shown = rows.length;
  const totalShown = typeof total === "number" ? total : shown;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href={backHref} className="text-sm text-zinc-600 hover:text-zinc-800">
        ← Tilbage til Eksamen
      </Link>

      <h1 className="mt-4 text-xl font-semibold">
        {title} (seneste {shown} af {totalShown})
      </h1>

      <p className="mt-2 text-sm text-zinc-600">Der gemmes maksimalt 50 runder pr. bruger.</p>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          Ingen runder endnu. Start en runde i Eksamen.
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {rows.map((r) => {
            const folderName = r.folder_id ? folderMap.get(r.folder_id) ?? "Ukendt mappe" : null;
            const label = folderName ?? compactFolderLabel(readMetaFolderIds(r.meta), folderMap) ?? "Flere mapper";
            return (
              <div key={r.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium text-zinc-900">{formatScore(r.score)}</div>
                  <div className="text-zinc-500">{formatDT(r.created_at)}</div>
                </div>
                <div className="mt-1 text-xs text-zinc-600">{label}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
