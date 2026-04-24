// app/traener/ux/ClientTrainer.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LimitNotice from "../_ui/LimitNotice";
import TrainingScopeCard from "../_ui/TrainingScopeCard";
import { buildTrainerFeedbackText } from "@/lib/trainer/feedback";
import { fetchQuotaCurrent } from "@/lib/quota/current-client";
import FeatureScopePicker from "@/components/training/FeatureScopePicker";
import MathMarkdown from "@/components/ui/MathMarkdown";

type Folder = { id: string; name: string };

type Props = {
  ownerId?: string;
  activeFolderId?: string | null;
  folders?: Folder[];
  scopeFolderIds?: string[];
  selectedScopeNames?: string[];
  showFirstUseCta?: boolean;
  demoMode?: boolean;
  demoScopeName?: string | null;

  folderId?: string | null;
  folderName?: string | null;
  noteId?: string | null;
  selectedNoteTitle?: string | null;
};

type Citation = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type EvalResult = {
  feedback: string;
  score: number | null;
  citations: Citation[];
  usedFileId: string | null;
};

type FocusMode = "normal" | "weakest";

type CitationObj = {
  chunkId?: string;
  id?: string;
  fileId?: string | null;
  file_id?: string | null;
  title?: string | null;
  url?: string | null;
};

const EVAL_ATTEMPTS_MAX = 2;
const EVAL_LOADING_STEPS = [
  "Læser dit svar…",
  "Finder relevante pointer i materialet…",
  "Vurderer faglighed og struktur…",
  "Skriver feedback…",
] as const;

// Fixed demo hook: replace these constants if/when a stronger Samfund source is added.
const DEMO_SOURCE_TITLE = "Samfund: velfærdsstat og politisk deltagelse (demo)";
const DEMO_SOURCE_URL = "/traener?demo=1";
const DEMO_QUESTION =
  "Redegør for, hvordan den danske velfærdsstat finansieres gennem skatter og afgifter.\n\nVurder kort, hvordan høj skat både kan styrke velfærden og skabe udfordringer for borgere eller virksomheder. Brug centrale samfundsfaglige begreber i din forklaring.";
const DEMO_KEYWORDS = ["skat", "velfærdsstat", "offentlige ydelser", "fordel", "udfordring", "omfordeling", "borger"] as const;

function preserveDanishText(value: string) {
  return String(value ?? "").normalize("NFC");
}

function nowClientMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clientWaitMs(startedAt: number) {
  return Math.max(0, Math.round(nowClientMs() - startedAt));
}

async function trackClientEvent(eventName: string, metadata?: Record<string, unknown>) {
  const payload = JSON.stringify({ eventName, metadata: metadata ?? {} });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      const queued = navigator.sendBeacon("/api/track", blob);
      if (queued) return;
    }

    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: payload,
    });
  } catch {
    // best effort
  }
}

function clampScore(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];

  for (const c of citations) {
    const key = [
      (c.title ?? "").trim().toLowerCase(),
      (c.url ?? "").trim().toLowerCase(),
      (c.fileId ?? "").trim().toLowerCase(),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }

  return out;
}

function normalizeCitations(input: unknown): Citation[] {
  if (!input) return [];

  if (Array.isArray(input) && input.every((x) => typeof x === "string")) {
    const out: Citation[] = (input as string[])
      .map((s, i) => {
        const t = String(s ?? "").trim();
        if (!t) return null;
        return { chunkId: `legacy-${i}`, fileId: null, title: t, url: null };
      })
      .filter(Boolean) as Citation[];

    return dedupeCitations(out);
  }

  if (Array.isArray(input)) {
    const out: Citation[] = [];
    for (const x of input) {
      if (!x || typeof x !== "object") continue;
      const obj = x as CitationObj;

      const chunkId = String(obj.chunkId ?? obj.id ?? "").trim();
      const fileIdRaw = obj.fileId ?? obj.file_id ?? null;
      const fileId = fileIdRaw ? String(fileIdRaw).trim() : null;

      const title = obj.title != null && String(obj.title).trim() ? String(obj.title).trim() : null;
      const url = obj.url != null && String(obj.url).trim() ? String(obj.url).trim() : null;

      if (!chunkId && !title && !url && !fileId) continue;

      out.push({
        chunkId: chunkId || `c-${out.length}`,
        fileId,
        title,
        url,
      });
    }

    return dedupeCitations(out);
  }

  return [];
}

function citationLabel(c: Citation, i: number) {
  return c.title || c.url || `Kilde ${i + 1}`;
}

function evaluateDemoAnswer(answer: string): EvalResult {
  const lower = answer.toLowerCase();
  const found = DEMO_KEYWORDS.filter((keyword) => lower.includes(keyword));
  const coverage = DEMO_KEYWORDS.length > 0 ? found.length / DEMO_KEYWORDS.length : 0;
  const score = Math.max(35, Math.min(100, Math.round(coverage * 100)));
  const answerLength = answer.trim().length;
  const mentionsPublicServices = /(offentlige ydelser|sundhed|uddannelse|velfærd)/.test(lower);
  const mentionsTradeoff = /(udfordring|ulempe|arbejdsudbud|virksom|incitament|konkurrence)/.test(lower);

  let overall = "Overordnet et fint udgangspunkt, hvor du viser forståelse for sammenhængen mellem skat og finansiering af velfærdsstaten.";
  let strengths = ["Du rammer emnet og får koblet skat til finansiering af velfærdsstaten på en fagligt relevant måde."];
  let improvements = ["Gør diskussionen skarpere ved tydeligt at skille mellem fordelene ved finansiering og de mulige samfundsøkonomiske omkostninger."];
  const nextSteps = ["Skriv et forbedret svar, hvor du bruger 2-3 centrale begreber og afslutter med en kort samlet vurdering."];

  if (coverage >= 0.72) {
    overall = "Overordnet et stærkt og træner-relevant svar, hvor du både redegør og vurderer med en klar faglig retning.";
    strengths = [
      "Du kommer godt omkring både finansiering, omfordeling og konsekvenserne af høj skat.",
      "Svaret ligner en rigtig træner-besvarelse, fordi du både redegør og vurderer i samme svar.",
    ];
    improvements = [
      "Løft svaret yderligere ved at bruge endnu tydeligere fagbegreber.",
      "Afslut gerne med en kort samlet vurdering af balancen mellem tryghed og incitamenter.",
    ];
  } else if (coverage >= 0.45) {
    overall = "Overordnet et fornuftigt svar, som er på rette vej, men som stadig kan blive mere præcist og mere vurderende.";
    strengths = ["Du har et fornuftigt fagligt udgangspunkt og får koblet skat til velfærdsstaten på en måde, der fungerer i Trainer."];
  }

  if (!mentionsPublicServices) {
    improvements.push("Nævn gerne konkrete offentlige ydelser som sundhed, uddannelse eller overførsler.");
  }

  if (!mentionsTradeoff) {
    improvements.push("Få også en tydelig udfordring med, fx arbejdsudbud, incitament eller konkurrenceevne.");
  }

  if (answerLength < 180) {
    improvements.push("Skriv lidt mere uddybende, så din argumentation bliver lettere at vurdere.");
  }

  const feedback = buildTrainerFeedbackText({
    overall,
    strengths,
    improvements,
    nextSteps,
  });

  return {
    score,
    feedback,
    usedFileId: "demo-samfund-source",
    citations: [
      {
        chunkId: "demo-samfund-source",
        fileId: null,
        title: DEMO_SOURCE_TITLE,
        url: DEMO_SOURCE_URL,
      },
    ],
  };
}

function clampInt(n: any, min: number, max: number) {
  const x = Number.isFinite(Number(n)) ? Math.round(Number(n)) : min;
  return Math.min(max, Math.max(min, x));
}

function pickTrainerQuota(json: any): { used: number; limit: number | null } {
  const used =
    (typeof json?.trainer_round?.usedThisMonth === "number" ? json.trainer_round.usedThisMonth : null) ??
    (typeof json?.trainer_round?.used_this_month === "number" ? json.trainer_round.used_this_month : null) ??
    (typeof json?.trainerUsedThisMonth === "number" ? json.trainerUsedThisMonth : null) ??
    0;

  const limit =
    (typeof json?.trainer_round?.limitPerMonth === "number" ? json.trainer_round.limitPerMonth : null) ??
    (typeof json?.trainerLimitPerMonth === "number" ? json.trainerLimitPerMonth : null) ??
    null;

  return { used: clampInt(used, 0, 1_000_000), limit: typeof limit === "number" ? clampInt(limit, 0, 1_000_000) : null };
}

export default function ClientTrainer({
  ownerId,
  activeFolderId,
  folders,
  scopeFolderIds,
  selectedScopeNames: selectedScopeNamesProp,
  showFirstUseCta = false,
  demoMode = false,
  demoScopeName = null,
  folderId,
  noteId,
}: Props) {
  void ownerId;

  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillAppliedRef = useRef(false);
  const [prefilledFolderId, setPrefilledFolderId] = useState<string | null>(null);

  const effectiveFolderId = prefilledFolderId ?? folderId ?? activeFolderId ?? null;
  const effectiveScopeFolderIds = useMemo(() => {
    if ((scopeFolderIds?.length ?? 0) > 0) return scopeFolderIds ?? [];
    return effectiveFolderId ? [effectiveFolderId] : [];
  }, [scopeFolderIds, effectiveFolderId]);

  const selectedScopeNames = useMemo(() => {
    const explicitNames =
      Array.isArray(selectedScopeNamesProp) && selectedScopeNamesProp.length > 0
        ? selectedScopeNamesProp.map((name) => String(name ?? "").trim()).filter(Boolean)
        : [];
    if (explicitNames.length > 0) return explicitNames;
    const ids = Array.from(new Set(effectiveScopeFolderIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
    const folderMap = new Map((folders ?? []).map((f) => [f.id, f.name]));
    return ids.map((id) => folderMap.get(id)).filter(Boolean) as string[];
  }, [effectiveScopeFolderIds, folders, selectedScopeNamesProp]);

  useEffect(() => {
    console.log("[client-trainer-scope-debug]", {
      selectedScopeNamesProp,
      effectiveScopeFolderIds,
      selectedScopeNames,
      folderCount: folders?.length ?? 0,
      folders: (folders ?? []).map((folder) => ({ id: folder.id, name: folder.name })),
    });
  }, [effectiveScopeFolderIds, folders, selectedScopeNames, selectedScopeNamesProp]);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const includeBackground = true;

  const [questionFileId, setQuestionFileId] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const questionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ✅ runde-id (betales på generate)
  const [roundId, setRoundId] = useState<string | null>(null);

  // ✅ antal eval-forsøg brugt i denne runde (lokalt UI)
  const [evalAttemptsUsed, setEvalAttemptsUsed] = useState(0);

  // ✅ “Tilpas / Færdig”
  const [questionEditable, setQuestionEditable] = useState(false);

  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [loadingEval, setLoadingEval] = useState(false);
  const [loadingEvalStep, setLoadingEvalStep] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<FocusMode>("normal");

  // ✅ quota state som MC: vis med det samme + disable knap
  const [limitReached, setLimitReached] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  useEffect(() => {
    if (prefillAppliedRef.current) return;

    const folderParam = searchParams.get("folder");
    const scopeParam = searchParams.get("scope");
    const focusParam = searchParams.get("focus");

    if (!folderParam && !focusParam) {
      prefillAppliedRef.current = true;
      return;
    }

    if (scopeParam) {
      setFocusMode(focusParam === "weakest" ? "weakest" : "normal");
      prefillAppliedRef.current = true;
      return;
    }

    const canValidate = Array.isArray(scopeFolderIds) || Array.isArray(folders);
    if (folderParam && !canValidate) return;

    const folderAllowed =
      !!folderParam &&
      (((scopeFolderIds?.length ?? 0) > 0 && (scopeFolderIds?.includes(folderParam) ?? false)) ||
        (folders?.some((f) => f.id === folderParam) ?? false));

    if (folderAllowed) {
      setPrefilledFolderId(folderParam);
      setFocusMode(focusParam === "weakest" ? "weakest" : "normal");
      router.replace(`/traener?scope=${encodeURIComponent(folderParam)}`);
    } else {
      setFocusMode("normal");
      router.replace("/traener");
    }

    prefillAppliedRef.current = true;
  }, [folders, router, scopeFolderIds, searchParams]);

  useEffect(() => {
    const el = questionTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = "hidden";
  }, [question]);

  const clearMessages = () => {
    setErrorMsg(null);
  };

  const dispatchQuotaChanged = () => {
    try {
      window.dispatchEvent(new Event("notely-quota-changed"));
    } catch {
      // ignore
    }
  };

  const checkQuotaNow = useMemo(() => {
    return async (force = false) => {
      if (demoMode) {
        setLimitReached(false);
        setLimitMessage(null);
        return;
      }
      try {
        const json = await fetchQuotaCurrent({ force });
        if (!json?.ok) return;

        const { used, limit } = pickTrainerQuota(json);
        if (typeof limit === "number" && limit > 0 && used >= limit) {
          setLimitReached(true);
          setLimitMessage(null);
        } else {
          setLimitReached(false);
          setLimitMessage(null);
        }
      } catch {
        // fail-open
      }
    };
  }, [demoMode]);

  // ✅ ved load + når sidebar siger quota ændret
  useEffect(() => {
    let alive = true;

    void (async () => {
      if (!alive) return;
      await checkQuotaNow();
    })();

    const onQuota = () => void checkQuotaNow(true);
    window.addEventListener("notely-quota-changed", onQuota);
    return () => {
      alive = false;
      window.removeEventListener("notely-quota-changed", onQuota);
    };
  }, [checkQuotaNow]);

  useEffect(() => {
    if (!loadingEval) {
      setLoadingEvalStep(0);
      return;
    }

    setLoadingEvalStep(0);
    const timeouts = [
      window.setTimeout(() => setLoadingEvalStep(1), 3000),
      window.setTimeout(() => setLoadingEvalStep(2), 6000),
      window.setTimeout(() => setLoadingEvalStep(3), 9000),
    ];

    return () => {
      for (const timeoutId of timeouts) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [loadingEval]);

  const hasSelectedFolder = !!effectiveFolderId || effectiveScopeFolderIds.length > 0;
  const effectiveFocusMode: FocusMode = !demoMode && hasSelectedFolder ? focusMode : "normal";

  const handleGenerateQuestion = async () => {
    clearMessages();

    if (limitReached) return;
    if (!demoMode && !hasSelectedFolder) {
      setErrorMsg("Vælg en mappe før du genererer et spørgsmål.");
      return;
    }

    setLoadingQuestion(true);

    try {
      if (demoMode) {
        setQuestion(preserveDanishText(DEMO_QUESTION));
        setQuestionEditable(false);
        setAnswer("");
        setEvalResult(null);
        setQuestionFileId("demo-samfund-source");
        setRoundId("demo-samfund-round");
        setEvalAttemptsUsed(0);
        void trackClientEvent("trainer_question_generated", {
          source: "demo",
          file_id: "demo-samfund-source",
          feature: "trainer",
          scope: demoScopeName ?? "Samfund",
        });
        return;
      }

      const startedAt = nowClientMs();
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: effectiveFolderId ?? null,
          scopeFolderIds: effectiveScopeFolderIds,
          roundId,
          focusMode: effectiveFocusMode,
        }),
      });

      const data = await res.json().catch(() => null);
      const requestId =
        typeof (data as any)?.requestId === "string"
          ? String((data as any).requestId)
          : typeof (data as any)?.meta?.requestId === "string"
            ? String((data as any).meta.requestId)
            : null;
      console.info("[client-trainer] generate-question", {
        requestId,
        status: res.status,
        ok: res.ok,
        clientWaitMs: clientWaitMs(startedAt),
      });

      // ✅ quota / limit
      if (res.status === 402 || res.status === 429) {
        setLimitReached(true);
        setLimitMessage(String((data as any)?.error ?? "").trim() || null);
        dispatchQuotaChanged();
        return;
      }

      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke generere spørgsmål";
        throw new Error(msg);
      }

      const q =
        (data as any)?.question ||
        (data as any)?.prompt ||
        "Formulér et kort eksamensspørgsmål inden for dette emne.";

      const usedFileId = (data as any)?.usedFileId ? String((data as any).usedFileId) : null;
      const newRoundIdRaw = (data as any)?.roundId ?? (data as any)?.round_id ?? null;
      const newRoundId = newRoundIdRaw ? String(newRoundIdRaw) : null;

      setQuestion(preserveDanishText(String(q)));
      setQuestionEditable(false);
      setAnswer("");
      setEvalResult(null);

      setQuestionFileId(usedFileId);
      setRoundId(newRoundId);

      // ✅ ny runde => reset eval-forsøg (så knappen starter som “Evaluer svar”)
      setEvalAttemptsUsed(0);

      dispatchQuotaChanged();
    } catch (err: any) {
      console.warn("[client-trainer] generate-question", {
        requestId: null,
        ok: false,
        error: err?.message ?? "Fejl ved generering af spørgsmål.",
      });
      setErrorMsg(err?.message || "Fejl ved generering af spørgsmål.");
    } finally {
      setLoadingQuestion(false);
    }
  };

  const handleEvaluate = async () => {
    clearMessages();

    if (!question || !answer.trim()) {
      setErrorMsg("Udfyld både spørgsmål og svar før du evaluerer.");
      return;
    }

    if (!roundId) {
      setErrorMsg("Tryk “Generér nyt spørgsmål” først for at starte en runde.");
      return;
    }

    // ✅ 2 forsøg pr. runde (UI-guard)
    if (evalAttemptsUsed >= EVAL_ATTEMPTS_MAX) {
      setErrorMsg("Denne runde er brugt op. Generér et nyt spørgsmål for at starte en ny runde.");
      return;
    }

    setLoadingEval(true);

    try {
      if (demoMode) {
        setEvalResult(evaluateDemoAnswer(answer));
        setEvalAttemptsUsed((n) => Math.min(EVAL_ATTEMPTS_MAX, n + 1));
        void trackClientEvent("trainer_answer_evaluated", {
          source: "demo",
          file_id: "demo-samfund-source",
          feature: "trainer",
          scope: demoScopeName ?? "Samfund",
        });
        return;
      }

      const startedAt = nowClientMs();
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: question, // legacy
          question,
          answer,
          includeBackground,
          folder_id: effectiveFolderId ?? null,
          note_id: noteId ?? null,
          scopeFolderIds: effectiveScopeFolderIds,
          source_type: "trainer",

          round_id: roundId,
          file_id: questionFileId ?? null,
        }),
      });

      const data = await res.json().catch(() => null);
      const requestId =
        typeof (data as any)?.requestId === "string"
          ? String((data as any).requestId)
          : typeof (data as any)?.meta?.requestId === "string"
            ? String((data as any).meta.requestId)
            : null;
      console.info("[client-trainer] evaluate", {
        requestId,
        status: res.status,
        ok: res.ok,
        clientWaitMs: clientWaitMs(startedAt),
      });

      // ✅ hvis runden er brugt op (server-guard), så disable “Prøv igen”
      if (res.status === 402) {
        const msg = String((data as any)?.error ?? "").trim() || "Denne runde er brugt op. Generér et nyt spørgsmål.";
        setEvalAttemptsUsed(EVAL_ATTEMPTS_MAX);
        setErrorMsg(msg);
        return;
      }

      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke evaluere (tomt svar fra server).";
        throw new Error(msg);
      }

      const score = clampScore((data as any).score ?? (data as any).grade);
      const feedback = String((data as any).feedback ?? (data as any).evaluation ?? "").trim();

      const citations = normalizeCitations((data as any).citations ?? (data as any).sources ?? []);
      const usedFileId = (data as any).usedFileId ? String((data as any).usedFileId) : null;

      setEvalResult({
        feedback: feedback || "Ingen feedback (tomt svar).",
        score,
        citations,
        usedFileId,
      });

      // ✅ efter første eval: knappen skal næste gang stå “Prøv igen”
      setEvalAttemptsUsed((n) => Math.min(EVAL_ATTEMPTS_MAX, n + 1));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("trainer:evaluations-changed"));
      }
      router.refresh();
    } catch (err: any) {
      console.warn("[client-trainer] evaluate", {
        requestId: null,
        ok: false,
        error: err?.message ?? "Fejl ved evaluering.",
      });
      setErrorMsg(err?.message || "Fejl ved evaluering.");
    } finally {
      setLoadingEval(false);
    }
  };

  const evalBtnText =
    loadingEval ? EVAL_LOADING_STEPS[loadingEvalStep] : evalAttemptsUsed === 1 ? "Prøv igen" : "Evaluer svar";

  const evalBtnDisabled = loadingEval || evalAttemptsUsed >= EVAL_ATTEMPTS_MAX;
  const scopeEmptyLabel = showFirstUseCta
    ? "Upload eget materiale eller prøv demo for at komme i gang."
    : "Vælg eller skift mappe her.";

  return (
    <div className="space-y-4">
      {showFirstUseCta ? (
        <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Kom i gang</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Du har ikke eget materiale klar endnu. Du kan starte med en demo eller uploade dit eget materiale.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            href="/traener?demo=1"
                            className="rounded-lg border px-3 py-2 text-xs font-medium text-black"
                            onClick={() =>
                              void trackClientEvent("demo_started", {
                                source: "demo",
                                feature: "trainer",
                                scope: "Samfund",
                              })
                            }
                            style={{
                              borderColor: "#ffbf00",
                              backgroundColor: "#ffbf00",
                              color: "#000000",
                            }}
                          >
              Prøv demo
            </Link>
            <Link
              href="/traener/upload"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Upload eget materiale
            </Link>
          </div>
        </section>
      ) : null}

      <TrainingScopeCard
        names={selectedScopeNames}
        className="hidden md:block"
        emptyLabel={scopeEmptyLabel}
      >
        {demoMode ? (
          <div
            className="inline-flex rounded-full border px-2 py-1 text-[11px] font-medium"
            style={{
              borderColor: "#ffbf00",
              backgroundColor: "#ffbf00",
              color: "#000000",
            }}
          >
            Demo-materiale
          </div>
        ) : null}
        {!demoMode ? (
          <label className="mt-3 inline-flex items-start gap-2 text-xs text-zinc-700">
            <input
              type="checkbox"
              checked={effectiveFocusMode === "weakest"}
              disabled={!hasSelectedFolder}
              onChange={(e) => setFocusMode(e.target.checked ? "weakest" : "normal")}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-black text-zinc-900 focus:ring-zinc-900/20 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>
              <span className="block font-medium">Træn på mine svage punkter</span>
              <span className="block text-zinc-500">Bruger seneste vurderinger i valgt mappe.</span>
            </span>
          </label>
        ) : null}
        {effectiveFocusMode === "weakest" ? (
          <div className="mt-2">
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
              Målrettet
            </span>
          </div>
        ) : null}
      </TrainingScopeCard>

      <TrainingScopeCard names={selectedScopeNames} className="p-4 md:hidden" emptyLabel={scopeEmptyLabel}>
        {!demoMode ? (
          <FeatureScopePicker
            selectedNames={selectedScopeNames}
            selectedScopeIds={effectiveScopeFolderIds}
            initialFolders={(folders ?? []).map((folder) => ({ id: folder.id, name: folder.name }))}
          />
        ) : null}
        {demoMode ? (
          <div
            className="mb-3 inline-flex rounded-full border px-2 py-1 text-[11px] font-medium"
            style={{
              borderColor: "#ffbf00",
              backgroundColor: "#ffbf00",
              color: "#000000",
            }}
          >
            Demo-materiale
          </div>
        ) : null}
        {!demoMode ? (
          <label className="mt-3 inline-flex items-start gap-2 text-xs text-zinc-700">
            <input
              type="checkbox"
              checked={effectiveFocusMode === "weakest"}
              disabled={!hasSelectedFolder}
              onChange={(e) => setFocusMode(e.target.checked ? "weakest" : "normal")}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-black text-zinc-900 focus:ring-zinc-900/20 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>
              <span className="block font-medium">Træn på mine svage punkter</span>
              <span className="block text-zinc-500">Bruger seneste vurderinger i valgt mappe.</span>
            </span>
          </label>
        ) : null}
        {effectiveFocusMode === "weakest" ? (
          <div className="mt-2">
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
              Målrettet
            </span>
          </div>
        ) : null}
      </TrainingScopeCard>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Spørgsmål / øvelse</h3>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuestionEditable((v) => !v)}
              disabled={!question}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              title="Lås op for redigering af spørgsmålet"
            >
              {questionEditable ? "Færdig" : "Tilpas"}
            </button>

            <button
              type="button"
              onClick={handleGenerateQuestion}
              disabled={loadingQuestion || limitReached || (!demoMode && !hasSelectedFolder)}
              className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
            >
              {loadingQuestion ? "Genererer..." : "Generér nyt spørgsmål"}
            </button>
          </div>
        </div>

        {limitReached ? <LimitNotice feature="trainer_round" message={limitMessage} /> : null}

        {!question ? (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
            Generér et spørgsmål, når du er klar. Notely laver en øvelse ud fra dit valgte materiale.
          </div>
        ) : null}

        {questionEditable ? (
          <textarea
            ref={questionTextareaRef}
            className="mt-1 w-full min-h-[96px] rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/5"
            value={question}
            onChange={(e) => {
              clearMessages();
              setQuestion(preserveDanishText(e.target.value));
            }}
            placeholder="Dit spørgsmål vises her."
          />
        ) : question ? (
          <div className="mt-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900">
            <MathMarkdown
              content={question}
              preserveWhitespace
              className="text-sm leading-7 text-zinc-900 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
            />
          </div>
        ) : (
          <div className="mt-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
            Dit spørgsmål vises her.
          </div>
        )}

        <p className="text-[10px] text-zinc-500">
          {demoMode
            ? `Demoen bruger en fast ${demoScopeName ?? "Samfund"}-kilde, så du kan prøve træner-flowet uden eget materiale.`
            : "Du kan tilpasse spørgsmålet til det stof, du vil træne."}
        </p>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Dit svar</h3>
          <button
            type="button"
            onClick={handleEvaluate}
            disabled={evalBtnDisabled}
            className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
            title={evalAttemptsUsed >= EVAL_ATTEMPTS_MAX ? "Runden er brugt op – generér nyt spørgsmål." : undefined}
          >
            {evalBtnText}
          </button>
        </div>

        {!question ? (
          <p className="text-xs text-zinc-500">Når du har et spørgsmål, kan du skrive dit svar her og få feedback.</p>
        ) : null}

        <textarea
          className="mt-1 w-full min-h-[140px] rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/5"
          value={answer}
          onChange={(e) => {
            clearMessages();
            setAnswer(e.target.value);
          }}
          placeholder={question ? "Skriv dit svar her..." : "Dit svarfelt bliver klar, når du har et spørgsmål."}
        />
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Feedback</h3>
        </div>

        <div className="text-xs text-zinc-600">
          {evalResult ? (
            <>
              <div className="font-medium">Score: {evalResult.score ?? 0}/100</div>
              <MathMarkdown
                content={evalResult.feedback}
                preserveWhitespace
                className="mt-1 text-sm leading-7 text-zinc-700 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
              />

              {evalResult.citations.length > 0 && (
                <div className="mt-2 text-[10px] text-zinc-500">
                  <div className="font-semibold text-zinc-600">Baggrundslitteratur / kilder</div>
                  <ul className="mt-1 space-y-0.5">
                    {dedupeCitations(evalResult.citations).map((c, idx) => {
                      const label = citationLabel(c, idx);
                      return (
                        <li key={c.chunkId || `${c.fileId ?? "file"}-${idx}`} className="break-all">
                          {c.url ? (
                            <a className="underline" href={c.url} target="_blank" rel="noreferrer">
                              {label}
                            </a>
                          ) : (
                            <span>{label}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>{question ? "Skriv dit svar og tryk på “Evaluer svar”, så får du konkret feedback her." : "Din feedback vises her, når du har arbejdet med et spørgsmål."}</p>
          )}
        </div>
      </section>
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      )}
    </div>
  );
}
