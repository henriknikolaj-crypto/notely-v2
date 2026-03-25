import "server-only";

export type Difficulty = "easy" | "medium" | "hard";
export type FocusMode = "normal" | "weakest";

export type FileRow = {
  id: string;
  name: string | null;
  original_name: string | null;
  folder_id: string | null;
  created_at: string | null;
};

export type ChunkRow = {
  id: string;
  file_id: string;
  content: string | null;
  created_at: string | null;
  source_url?: string | null;
  extraction_method?: string | null;
  extraction_quality?: string | null;
  page_from?: number | null;
};

export type WeakPointTarget = {
  key: string;
  label: string;
  action?: string;
};

export function pickDifficulty(raw: any): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

export function clampInt(raw: any, min: number, max: number, fallback: number) {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(max, Math.max(min, n));
}

export function pickFocusMode(raw: any): FocusMode {
  return raw === "weakest" ? "weakest" : "normal";
}

export function uniqTrimmed(ids: unknown) {
  if (!Array.isArray(ids)) return [];
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

export function scopeKeyFromFolderIds(folderIds: string[]) {
  const ids = uniqTrimmed(folderIds).sort();
  return ids.length ? `folders:${ids.join(",")}` : "all";
}

export function fileTitle(row: any) {
  return (row?.name as string | null) || (row?.original_name as string | null) || "Ukendt kilde";
}

export function normalizeQuestion(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}]/g, "")
    .trim();
}

export function normalizeWeakPointTarget(raw: unknown): WeakPointTarget | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const keyRaw = String(obj.key ?? "").trim();
  const labelRaw = String(obj.label ?? "").trim();
  const actionRaw = String(obj.action ?? "").trim();

  const key = keyRaw || labelRaw.toLowerCase().replace(/\s+/g, "_").slice(0, 80);
  const label = labelRaw || keyRaw.replace(/_/g, " ");
  if (!key || !label) return null;

  const out: WeakPointTarget = { key, label };
  if (actionRaw) out.action = actionRaw;
  return out;
}

export function deriveFocusTargetsFromWeakSessions(rows: Array<{ metadata: any }>): WeakPointTarget[] {
  const acc = new Map<string, { target: WeakPointTarget; weight: number }>();

  for (let i = 0; i < rows.length; i++) {
    const weight = i < 10 ? 2 : 1;
    const metadata = rows[i]?.metadata as Record<string, unknown> | null;
    const weakRaw = metadata?.weak_points;
    if (!Array.isArray(weakRaw)) continue;

    for (const item of weakRaw) {
      const normalized = normalizeWeakPointTarget(item);
      if (!normalized) continue;
      const existing = acc.get(normalized.key);
      if (existing) {
        existing.weight += weight;
      } else {
        acc.set(normalized.key, { target: normalized, weight });
      }
    }
  }

  return Array.from(acc.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((x) => x.target);
}

export function buildGenerateQuestionPrompts(args: {
  topic: string;
  difficulty: Difficulty;
  effectiveFocusMode: FocusMode;
  focusTargets: WeakPointTarget[];
  avoidQuestions: string[];
  usedFileTitle: string;
  contextText: string;
}) {
  const { topic, difficulty, effectiveFocusMode, focusTargets, avoidQuestions, usedFileTitle, contextText } = args;

  const avoidBlock =
    avoidQuestions.length > 0
      ? `\nUNDGÅ at gentage nogen af disse spørgsmål (nøjagtigt eller næsten):\n- ${avoidQuestions.join("\n- ")}\n`
      : "";
  const focusBiasBlock =
    effectiveFocusMode === "weakest" && focusTargets.length > 0
      ? [
          `Fokusér især på: ${focusTargets.map((t) => t.label).join(", ")}. Spørgsmålet skal træne disse områder.`,
          ...focusTargets
            .map((t) => (t.action ? `Hint - ${t.label}: ${t.action}` : ""))
            .filter(Boolean),
        ].join("\n")
      : "";
  const biasApplied = effectiveFocusMode === "weakest" && focusTargets.length > 0;

	const systemPrompt = `
	Du er en dansk studieassistent.
	Du laver ét (1) eksamenslignende frit-svar spørgsmål ud fra elevens pensum-uddrag.

VIGTIGT:
- Du MÅ KUN bruge konteksten (KILDE-afsnit).
- Skriv alt på dansk.
- Ingen multiple choice.
	- Spørgsmålet skal være konkret og teste forståelse/anvendelse (ikke kun genkendelse).
	- Identificér først de centrale begreber, temaer eller problemstillinger i materialet.
	- Vælg derefter 1-2 af dem som fokus for spørgsmålet.
	- Vælg en passende spørgsmålsmode, fx: definér, redegør for, forklar, sammenlign, analysér, diskutér eller anvend på eksempel/case.
	- Hold spørgsmålet kort og fokuseret: én klar hovedopgave og højst én kort opfølgning.
	- Undgå lange nummererede delspørgsmål, brede mini-opgaver eller formuleringer, der føles som en hel skriftlig aflevering.
	- Sigt efter et spørgsmål, som en elev realistisk kan besvare i ét fokuseret svar.
	- Hvis materialet er kort eller repetitivt, skal du skabe variation gennem vinkel, framing og spørgsmålstype, ikke ved at opfinde nyt indhold.
	- Du må ikke opfinde teorier, kilder, cases eller fakta, som ikke er understøttet af materialet.

	Returnér gyldig JSON:
{
  "question": "..."
}
`.trim();

  const userPrompt = [
    `Fag/tema: ${topic}`,
    `Sværhedsgrad: ${difficulty}`,
    focusBiasBlock,
    `Kilde (primary): ${usedFileTitle}`,
    avoidBlock.trim(),
    "Arbejd ud fra centrale begreber og temaer i materialet, ikke kun enkelte linjer eller formuleringer.",
    "",
    "KONTEKST (brug dette som eneste grundlag):",
    "",
    contextText,
  ]
    .filter(Boolean)
    .join("\n");

  return { systemPrompt, userPrompt, biasApplied };
}
