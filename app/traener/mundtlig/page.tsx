// app/traener/mundtlig/page.tsx
import "server-only";

import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { getTrainerSession } from "@/lib/auth/trainer-session";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ClientOralExam from "./ClientOralExam";
import TrainingScopeCard from "../_ui/TrainingScopeCard";
import FeatureScopePicker from "@/components/training/FeatureScopePicker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
    if (k === "mode") continue;
    if (typeof v === "string" && v.trim()) params.set(k, v);
    else if (Array.isArray(v) && v.length) params.set(k, v.join(","));
  }

  for (const [k, v] of Object.entries(patch)) params.set(k, v);

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function normalizeIds(ids: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ids) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p || p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

async function listFolderOptions(sb: any, ownerId: string) {
  const { data, error } = await sb
    .from("folders")
    .select("id, name")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("[oral/page] folder options load error:", error);
    return [] as Array<{ id: string; name: string }>;
  }

  return ((data ?? []) as any[])
    .map((row) => {
      const id = String(row?.id ?? "").trim();
      const name = String(row?.name ?? "").trim();
      if (!id || !name) return null;
      return { id, name };
    })
    .filter(Boolean) as Array<{ id: string; name: string }>;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const sp = (await searchParams) ?? {};

  const activeFolderId = pickString(sp, "folder") || null;

  const scopeRaw = pickString(sp, "scope");
  const scopeIds = scopeRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const hrefSkrift = buildHref("/traener/simulator", sp, {});
  const hrefMundtlig = buildHref("/traener/mundtlig", sp, {});

  const sb = await supabaseServerRSC();
  const { ownerId } = await getTrainerSession();
  if (!ownerId) return null;

  // ✅ “Samfund +1” label ud fra scope/folder
  const trainingFolderIds = normalizeIds(scopeIds.length > 0 ? scopeIds : activeFolderId ? [activeFolderId] : []);
  const folderMap = new Map<string, string>();

  if (trainingFolderIds.length > 0) {
    const fr = await sb
      .from("folders")
      .select("id, name")
      .eq("owner_id", ownerId)
      .in("id", trainingFolderIds);

    if (!fr.error && Array.isArray(fr.data)) {
      for (const f of fr.data as any[]) {
        if (f?.id && f?.name) folderMap.set(String(f.id), String(f.name));
      }
    }
  }

  const resolvedTrainingFolderIds = trainingFolderIds.filter((id) => folderMap.has(id));
  const resolvedTrainingFolderNames = resolvedTrainingFolderIds.map((id) => folderMap.get(id) as string);
  const resolvedActiveFolderId = resolvedTrainingFolderIds[0] ?? null;
  const folderOptions = await listFolderOptions(sb, ownerId);

  // ✅ plan → isPro (brug service-role, så RLS/cache ikke kan give falsk "freemium")
  let isPro = false;
  try {
    const admin = supabaseAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", ownerId)
      .maybeSingle();

    const planRaw = (profile as any)?.plan ?? null;
    const planNorm = normalizePlan(planRaw);
    isPro = planNorm === "pro";

    if (process.env.NODE_ENV !== "production") {
      console.log("[oral page]", { ownerId, planRaw, planNorm, isPro });
    }
  } catch (e: any) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[oral page] plan lookup failed:", e?.message ?? String(e));
    }
    // fail-closed: isPro=false
    isPro = false;
  }

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
        {/* Toggle */}
        <div className="inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <Link href={hrefSkrift} className={cx("px-4 py-2 text-sm text-zinc-900", "bg-white hover:bg-zinc-50")}>
            Skriftlig
          </Link>

          <Link
            href={hrefMundtlig}
            className={cx("border-l border-zinc-200 px-4 py-2 text-sm text-zinc-900", "bg-zinc-200")}
          >
            Mundtlig
          </Link>
        </div>

        <TrainingScopeCard
          names={resolvedTrainingFolderNames}
          className="md:hidden"
          emptyLabel="Vælg en mappe direkte her."
          helpText="Eksamen kan først startes, når en mappe er valgt."
        >
          <FeatureScopePicker
            selectedNames={resolvedTrainingFolderNames}
            selectedScopeIds={resolvedTrainingFolderIds}
            initialFolders={folderOptions}
          />
        </TrainingScopeCard>
        <TrainingScopeCard
          names={resolvedTrainingFolderNames}
          className="hidden md:block"
          emptyLabel="Vælg en mappe i venstre side."
          helpText="Eksamen kan først startes, når en mappe er valgt."
        />

        <section className="rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="inline-flex shrink-0 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold tracking-wide text-zinc-600">
              Beta
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900">Mundtlig er i beta.</p>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Vi arbejder på at gøre oplevelsen mere naturlig og tættere på en rigtig mundtlig eksamen.
                Allerede nu kan du øve dine svar, træne din mundtlige formidling og blive mødt af opfølgende
                spørgsmål baseret på det, du siger.
              </p>
            </div>
          </div>
        </section>

        <ClientOralExam scopeFolderIds={resolvedTrainingFolderIds} activeFolderId={resolvedActiveFolderId} isPro={isPro} />
      </section>
    </main>
  );
}
