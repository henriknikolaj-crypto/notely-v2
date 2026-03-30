import "server-only";

import { resolveModelForFeature } from "@/lib/openai/model";

export type NotelyFlow = "trainer" | "simulator" | "oral";

export function requireFlowModel(flow: NotelyFlow): string {
  return resolveModelForFeature(flow);
}
