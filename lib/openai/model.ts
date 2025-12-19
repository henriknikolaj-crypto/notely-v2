import "server-only";

export type NotelyLLMMode = "default" | "trainer" | "simulator" | "oral";

export function getLLMModel(mode: NotelyLLMMode) {
  const fallback = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (mode === "trainer") return process.env.OPENAI_MODEL_TRAINER || fallback;
  if (mode === "simulator") return process.env.OPENAI_MODEL_SIMULATOR || fallback;
  if (mode === "oral") return process.env.OPENAI_MODEL_ORAL || fallback;

  return fallback;
}
