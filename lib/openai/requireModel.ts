import "server-only";

export type NotelyFlow = "trainer" | "simulator" | "oral";

export function requireFlowModel(flow: NotelyFlow): string {
  const key =
    flow === "trainer"
      ? "OPENAI_MODEL_TRAINER"
      : flow === "simulator"
        ? "OPENAI_MODEL_SIMULATOR"
        : "OPENAI_MODEL_ORAL";

  const primary = (process.env[key] ?? "").trim();
  if (primary) return primary;

  // Fallback (så dev ikke dør, hvis en flow-variabel mangler)
  const fallback = (process.env.OPENAI_MODEL ?? "").trim();
  if (fallback) return fallback;

  throw new Error(
    `Missing ${key} (required for ${flow}). Also missing OPENAI_MODEL fallback.`,
  );
}
