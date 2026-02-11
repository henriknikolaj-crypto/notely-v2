import "server-only";

import Link from "next/link";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import ClientOralExam from "./ClientOralExam";

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

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
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
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
  }

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

  const scopeCompact = compactFolderLabel(trainingFolderIds, folderMap);

  const scopeHelp = "Hele pensum";

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
            Skrift
          </Link>

          <Link
            href={hrefMundtlig}
            className={cx("border-l border-zinc-200 px-4 py-2 text-sm text-zinc-900", "bg-zinc-200")}
          >
            Mundtlig
          </Link>
        </div>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold">Træningsområde</h2>

          {scopeCompact ? (
            <p className="text-xs text-zinc-600">{scopeCompact}</p>
          ) : (
            <p className="text-xs text-zinc-600">{scopeHelp}</p>
          )}
        </section>

        <ClientOralExam scopeFolderIds={scopeIds} activeFolderId={activeFolderId} />
      </section>
    </main>
  );
}
