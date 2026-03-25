import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ClientWrittenExam from "./ClientWrittenExam";
import TrainingScopeCard from "../_ui/TrainingScopeCard";
import FeatureScopePicker from "@/components/training/FeatureScopePicker";

export const dynamic = "force-dynamic";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {}
  return null;
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

function compactFolderLabel(folderIds: string[], folderMap: Map<string, string>): string | null {
  const ids = normalizeIds(folderIds);
  if (ids.length === 0) return null;

  const names = ids.map((id) => folderMap.get(id)).filter((x): x is string => !!x);
  if (names.length === 0) return null;
  const first = names[0];
  const extra = ids.length - 1;
  return extra > 0 ? `${first} +${extra}` : first;
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
    console.error("[simulator/page] folder options load error:", error);
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

  const modeRaw = pickString(sp, "mode").toLowerCase();
  const isMundtlig = modeRaw === "mundtlig";

  const activeFolderId = pickString(sp, "folder") || null;

  const scopeRaw = pickString(sp, "scope");
  const scopeIds = scopeRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const hrefSkrift = buildHref("/traener/simulator", sp, {});
  const hrefMundtlig = buildHref("/traener/mundtlig", sp, {});

  // Hvis nogen rammer den gamle “mundtlig” variant på simulator-siden → send dem til den rigtige side
  if (isMundtlig) {
    redirect(hrefMundtlig);
  }

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
  }

  // ✅ Byg “Samfund +1” label ud fra scope/folder
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

  const scopeCompact = compactFolderLabel(trainingFolderIds, folderMap);
  const resolvedTrainingFolderIds = trainingFolderIds.filter((id) => folderMap.has(id));
  const resolvedActiveFolderId = resolvedTrainingFolderIds[0] ?? null;
  const folderOptions = await listFolderOptions(sb, ownerId);
  const { data: profile } = await sb
    .from("profiles")
    .select("plan")
    .eq("id", ownerId)
    .maybeSingle();
  const planRaw = (profile as any)?.plan ?? null;
  const planNorm = normalizePlan(planRaw);
  const isPro = planNorm === "pro";
  if (process.env.NODE_ENV !== "production") {
    console.log("[exam page]", { ownerId, planRaw, planNorm, isPro });
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
        {/* ✅ Skriftlig/Mundtlig toggle */}
        <div className="inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <Link
            href={hrefSkrift}
            className={cx("px-4 py-2 text-sm text-zinc-900", "bg-zinc-200 text-zinc-900")}
          >
            Skriftlig
          </Link>

          <Link
            href={hrefMundtlig}
            className={cx(
              "border-l border-zinc-200 px-4 py-2 text-sm text-zinc-900",
              "bg-white text-zinc-900 hover:bg-zinc-50",
            )}
          >
            Mundtlig
          </Link>
        </div>

        <TrainingScopeCard
          names={scopeCompact ? [scopeCompact] : []}
          className="md:hidden"
          emptyLabel="Vælg en mappe direkte her."
          helpText="Eksamen kan først startes, når en mappe er valgt."
        >
          <FeatureScopePicker
            selectedNames={scopeCompact ? [scopeCompact] : []}
            selectedScopeIds={resolvedTrainingFolderIds}
            initialFolders={folderOptions}
          />
          <div id="written-exam-training-area-slot" />
        </TrainingScopeCard>
        <TrainingScopeCard
          names={scopeCompact ? [scopeCompact] : []}
          className="hidden md:block"
          emptyLabel="Vælg en mappe i venstre side."
          helpText="Eksamen kan først startes, når en mappe er valgt."
        />

        <ClientWrittenExam
          scopeFolderIds={resolvedTrainingFolderIds}
          activeFolderId={resolvedActiveFolderId}
          trainingAreaSlotId="written-exam-training-area-slot"
          isPro={isPro}
        />
      </section>
    </main>
  );
}
