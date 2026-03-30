import "server-only";

export type NotelyFlow = "trainer" | "simulator" | "oral";

export type NotelyLLMMode = "default" | NotelyFlow;
export type OpenAIFeature =
  | "trainer"
  | "simulator"
  | "oral"
  | "oral_question"
  | "oral_eval"
  | "weakness"
  | "notes"
  | "mc"
  | "flashcards"
  | "generate_question"
  | "transcribe";

function fromEnv(key: string) {
  return String(process.env[key] ?? "").trim();
}

export function resolveModelForFeature(feature: OpenAIFeature): string {
  const keys =
    feature === "trainer"
      ? ["OPENAI_MODEL_TRAINER"]
      : feature === "simulator"
        ? ["OPENAI_MODEL_SIMULATOR", "OPENAI_MODEL_EXAM"]
        : feature === "oral_question"
          ? ["OPENAI_MODEL_ORAL_QUESTION", "OPENAI_MODEL_ORAL"]
          : feature === "oral_eval"
            ? ["OPENAI_MODEL_ORAL_EVAL", "OPENAI_MODEL_ORAL"]
        : feature === "oral"
          ? ["OPENAI_MODEL_ORAL"]
          : feature === "weakness"
            ? ["OPENAI_MODEL_WEAKNESS"]
            : feature === "notes"
              ? ["OPENAI_MODEL_NOTES"]
              : feature === "mc"
                ? ["OPENAI_MODEL_MC"]
                : feature === "flashcards"
                  ? ["OPENAI_MODEL_FLASHCARDS"]
                  : feature === "generate_question"
                    ? ["OPENAI_MODEL_GENERATE_QUESTION", "OPENAI_MODEL_QUESTION"]
                    : ["OPENAI_TRANSCRIBE_MODEL"];

  for (const key of keys) {
    const value = fromEnv(key);
    if (value) return value;
  }

  if (feature === "transcribe") {
    const transcribeFallback = fromEnv("OPENAI_TRANSCRIBE_MODEL");
    if (transcribeFallback) return transcribeFallback;
    return "gpt-4o-mini-transcribe";
  }

  const fallback = fromEnv("OPENAI_MODEL");
  if (fallback) return fallback;
  return "gpt-5-mini";
}

export function getLLMModel(mode: NotelyLLMMode) {
  if (mode === "trainer" || mode === "simulator" || mode === "oral") {
    return resolveModelForFeature(mode);
  }
  return (process.env.OPENAI_MODEL || "gpt-5-mini").trim();
}
