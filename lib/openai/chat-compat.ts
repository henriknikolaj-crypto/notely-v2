import "server-only";

type SamplingParams = {
  temperature: number;
  top_p?: number;
};

function normalizeModel(model: string): string {
  return String(model ?? "").trim().toLowerCase();
}

export function isGpt5FamilyModel(model: string): boolean {
  const m = normalizeModel(model);
  return m.startsWith("gpt-5");
}

export function samplingParamsForModel(
  model: string,
  params: SamplingParams,
): Partial<SamplingParams> {
  if (isGpt5FamilyModel(model)) return {};
  return params;
}

