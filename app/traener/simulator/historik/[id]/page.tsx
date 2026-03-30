import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined> | undefined;

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

function formatScore(score: number | null | undefined) {
  if (score == null) return "–";
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return `${s}%`;
}

function safeBackHref(raw: string | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  return s;
}

function normalizeMode(raw: unknown): "skrift" | "mundtlig" | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "mundtlig" || v === "oral") return "mundtlig";
  if (v === "skrift" || v === "written" || v === "simulator") return "skrift";
  return null;
}

function inferMode(session: any, queryMode: unknown): "skrift" | "mundtlig" {
  const direct = normalizeMode(queryMode);
  if (direct) return direct;
  const sourceType = String(session?.source_type ?? "").trim().toLowerCase();
  if (sourceType === "oral" || sourceType === "mundtlig" || sourceType.includes("oral")) return "mundtlig";
  const metaMode = normalizeMode(session?.meta?.mode);
  return metaMode ?? "skrift";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
    .filter(Boolean);
}

function folderLabel(session: any, folderMap: Map<string, string>) {
  const directId = typeof session?.folder_id === "string" ? session.folder_id : null;
  if (directId && folderMap.has(directId)) return folderMap.get(directId) ?? null;

  const ids = Array.isArray(session?.meta?.folder_ids)
    ? session.meta.folder_ids.map((item: unknown) => String(item ?? "").trim()).filter(Boolean)
    : Array.isArray(session?.meta?.scopeFolderIds)
    ? session.meta.scopeFolderIds.map((item: unknown) => String(item ?? "").trim()).filter(Boolean)
    : [];

  if (!ids.length) return null;
  const names = ids.map((id: string) => folderMap.get(id)).filter((name: string | undefined): name is string => !!name);
  if (!names.length) return ids.length > 1 ? `${ids.length} mapper` : "Ukendt mappe";
  return ids.length > 1 ? `${names[0]} +${ids.length - 1}` : names[0];
}

function readWrittenQuestions(meta: Record<string, any>, rawQuestion: string) {
  const snapshot = Array.isArray(meta.questions_snapshot) ? meta.questions_snapshot : [];
  if (snapshot.length) {
    return snapshot
      .map((item: any, index: number) => {
        const prompt = String(item?.prompt ?? "").trim();
        return prompt ? `Spørgsmål ${index + 1}\n${prompt}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return rawQuestion.trim();
}

function readWrittenAnswers(meta: Record<string, any>, rawAnswer: string) {
  const snapshot = Array.isArray(meta.answers_snapshot) ? meta.answers_snapshot : [];
  if (snapshot.length) {
    return snapshot
      .map((item: any, index: number) => {
        const text = String(item?.text ?? "").trim();
        return text ? `Svar ${index + 1}\n${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return rawAnswer.trim();
}

export default async function ExamHistoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const backTo = typeof sp.backTo === "string" ? sp.backTo : undefined;
  const sb = await supabaseServerRSC();

  const {
    data: { user },
  } = await sb.auth.getUser();

  const ownerId = user?.id ?? process.env.DEV_USER_ID ?? null;
  if (!ownerId) notFound();

  const { data, error } = await sb.from("exam_sessions").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error || !data) notFound();

  const mode = inferMode(data, typeof sp.mode === "string" ? sp.mode : undefined);
  const defaultBackHref = mode === "mundtlig" ? "/traener/mundtlig/historik" : "/traener/simulator/historik";
  const backHref = safeBackHref(backTo) ?? defaultBackHref;

  const folderIds = new Set<string>();
  if (typeof (data as any).folder_id === "string" && (data as any).folder_id) folderIds.add(String((data as any).folder_id));
  for (const raw of [...(((data as any).meta?.folder_ids as unknown[]) ?? []), ...(((data as any).meta?.scopeFolderIds as unknown[]) ?? [])]) {
    const idValue = String(raw ?? "").trim();
    if (idValue) folderIds.add(idValue);
  }

  const folderMap = new Map<string, string>();
  if (folderIds.size) {
    const { data: folders } = await sb
      .from("folders")
      .select("id, name")
      .eq("owner_id", ownerId)
      .in("id", Array.from(folderIds));
    for (const folder of folders ?? []) {
      if ((folder as any)?.id && (folder as any)?.name) {
        folderMap.set(String((folder as any).id), String((folder as any).name));
      }
    }
  }

  const label = folderLabel(data, folderMap);
  const score = (data as any).score as number | null | undefined;
  const createdAt = (data as any).created_at as string | null | undefined;
  const meta = ((data as any).meta ?? {}) as Record<string, any>;
  const rawQuestion = String((data as any).question ?? "").trim();
  const rawAnswer = String((data as any).answer ?? "").trim();
  const rawFeedback = String((data as any).feedback ?? "").trim();
  const oralFeedback = String((data as any).feedback ?? "").trim();
  const oralTranscript = String((data as any).answer ?? "").trim();
  const writtenResult = (meta.result ?? {}) as Record<string, any>;
  const writtenOverall = (writtenResult.overall ?? {}) as Record<string, any>;
  const writtenItems = Array.isArray(writtenResult.items) ? writtenResult.items : [];
  const strengths = normalizeStringArray(writtenOverall.strengths);
  const improvements = normalizeStringArray(writtenOverall.improvements);
  const summary = String(writtenOverall.summary ?? "").trim();
  const writtenQuestions = readWrittenQuestions(meta, rawQuestion);
  const writtenAnswers = readWrittenAnswers(meta, rawAnswer);
  const writtenFeedback = rawFeedback;
  const hasWrittenDetails = Boolean(summary || strengths.length || improvements.length || writtenItems.length || writtenQuestions || writtenAnswers || writtenFeedback);

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <Link href={backHref} className="text-sm text-zinc-600 hover:text-zinc-800">
        ← Tilbage til historik
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">
          {mode === "mundtlig" ? "Mundtlig evaluering" : "Skriftlig evaluering"}
        </h1>
        <p className="text-sm text-zinc-500">
          {formatDT(createdAt)}
          {label ? ` · ${label}` : ""}
          {score != null ? ` · ${formatScore(score)}` : ""}
        </p>
      </header>

      {mode === "mundtlig" ? (
        <>
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">Feedback</h2>
            <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-800">{oralFeedback || "Ingen feedback gemt."}</div>
          </section>

          {oralTranscript ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">Samtale</h2>
              <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-800">{oralTranscript}</div>
            </section>
          ) : null}
        </>
      ) : (
        <>
          {summary || writtenFeedback ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">Samlet vurdering</h2>
              <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-800">{summary || writtenFeedback}</div>
            </section>
          ) : null}

          {writtenQuestions ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">Spørgsmål</h2>
              <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-800">{writtenQuestions}</div>
            </section>
          ) : null}

          {writtenAnswers ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">Dine svar</h2>
              <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-800">{writtenAnswers}</div>
            </section>
          ) : null}

          {strengths.length ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">Styrker</h2>
              <ul className="space-y-2 text-sm leading-7 text-zinc-800">
                {strengths.map((item, index) => (
                  <li key={`${item}-${index}`}>- {item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {improvements.length ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">Det kan forbedres</h2>
              <ul className="space-y-2 text-sm leading-7 text-zinc-800">
                {improvements.map((item, index) => (
                  <li key={`${item}-${index}`}>- {item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {writtenItems.length ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-900">Delvurderinger</h2>
              <div className="space-y-3">
                {writtenItems.map((item: any, index: number) => (
                  <div key={String(item?.id ?? index)} className="rounded-xl border border-zinc-200 p-3">
                    <div className="text-xs font-medium text-zinc-600">Del {index + 1}{item?.grade ? ` · ${item.grade}` : ""}</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm leading-7 text-zinc-800">
                      {String(item?.feedback ?? "").trim() || "Ingen feedback gemt."}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {!hasWrittenDetails ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
              Detaljer findes ikke for denne ældre historikpost.
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
