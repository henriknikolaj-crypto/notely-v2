import "server-only";

import OpenAI from "openai";
import { resolveModelForFeature, type OpenAIFeature } from "@/lib/openai/model";

type ChatPayload = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

type SanitizePurpose = "default" | "json";

function normalizeModel(model: string) {
  return String(model ?? "").trim().toLowerCase();
}

function isGpt5FamilyModel(model: string) {
  return normalizeModel(model).startsWith("gpt-5");
}

function isTranscribeModel(model: string) {
  return normalizeModel(model).includes("transcribe");
}

export function sanitizeOpenAIPayload(
  model: string,
  payload: ChatPayload,
  purpose: SanitizePurpose = "default",
): { payload: ChatPayload; removedKeys: string[] } {
  const removedKeys: string[] = [];
  const out: Record<string, unknown> = { ...payload, model };

  if (purpose === "json" && !out.response_format) {
    out.response_format = { type: "json_object" };
  }

  if (isGpt5FamilyModel(model)) {
    for (const key of ["temperature", "top_p", "frequency_penalty", "presence_penalty"]) {
      if (key in out) {
        delete out[key];
        removedKeys.push(key);
      }
    }
  }

  return {
    payload: out as unknown as ChatPayload,
    removedKeys,
  };
}

type CreateChatCompletionArgs = {
  feature: Exclude<OpenAIFeature, "transcribe">;
  payload: Omit<ChatPayload, "model">;
  purpose?: SanitizePurpose;
  modelOverride?: string;
};

export async function createChatCompletion(
  openai: OpenAI,
  args: CreateChatCompletionArgs,
) {
  const model = args.modelOverride?.trim() || resolveModelForFeature(args.feature);
  if (isTranscribeModel(model)) {
    throw new Error(`Resolved model '${model}' is a transcribe model and cannot be used for chat completions.`);
  }

  const { payload, removedKeys } = sanitizeOpenAIPayload(
    model,
    { ...(args.payload as ChatPayload), model },
    args.purpose ?? "default",
  );

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[openai-compat] feature=${args.feature} model=${model} removedKeys=${removedKeys.join(",") || "(none)"}`,
    );
  }

  const completion = await openai.chat.completions.create(payload);
  return { completion, model, removedKeys };
}
