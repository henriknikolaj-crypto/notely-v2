import "server-only";

import { requireFlowModel, type NotelyFlow } from "@/lib/openai/requireModel";

export type NotelyLLMMode = "default" | NotelyFlow;

export function getLLMModel(mode: NotelyLLMMode) {
  if (mode === "trainer" || mode === "simulator" || mode === "oral") {
    return requireFlowModel(mode);
  }
  return (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
}
