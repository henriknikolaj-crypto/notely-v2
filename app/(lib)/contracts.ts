import { z } from "zod";

export const GenQResponse = z.object({
  question: z.string(),
  sources: z.array(z.string()).optional().default([]),
  model: z.string(),
  job_id: z.string().uuid().nullable().optional(),
  latency_ms: z.number().optional(),
});
export type GenQResponseT = z.infer<typeof GenQResponse>;

export const EvaluateResponse = z.object({
  question: z.string(),
  answer: z.string(),
  score: z.number().min(0).max(100),
  feedback: z.string(),
  model: z.string(),
});
export type EvaluateResponseT = z.infer<typeof EvaluateResponse>;

