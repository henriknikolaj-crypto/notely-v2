import "server-only";

export type NotelyFlow = "trainer" | "simulator" | "oral";

export function requireFlowModel(flow: NotelyFlow): string {
  const key =
    flow === "trainer"
      ? "OPENAI_MODEL_TRAINER"
      : flow === "simulator"
      ? "OPENAI_MODEL_SIMULATOR"
      : "OPENAI_MODEL_ORAL";

  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing ${key} (required for ${flow})`);
  }
  return value.trim();
}
