// lib/retrieval/withAutoRanking.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyAcademicDanishScoring,
  type RankCandidate,
} from "@/lib/retrieval/score";

export type RankedResult = {
  rankedText: string;
  candidates: Array<RankCandidate & { finalScore: number }>;
  weights: { alpha: number; beta: number; mLang: number; mDomain: number };
};

/**
 * Autoranker retrieval-kandidater ved at læse vægte (α/β) fra DB
 * og beregner finalScore pr. kandidat. Returnerer både rankedText
 * (til kontekst) og de scorede kandidater + anvendte vægte.
 */
export async function withAutoRanking(
  supabase: SupabaseClient,
  retrieval: { candidates?: any[] } | null | undefined,
  topK = 20,
  ownerId?: string | null
): Promise<RankedResult> {
  // 1) Map rå-kandidater til RankCandidate
  const raw: RankCandidate[] = (retrieval?.candidates ?? []).map((c: any) => ({
    id: c?.id,
    text: (c?.text ?? c?.chunk ?? c?.body ?? "").toString(),
    similarity: Number(c?.similarity ?? 0),
    verified_weight: Number(c?.verified_weight ?? c?.weights?.verified ?? 0),
    manual_academic_weight: Number(c?.manual_academic_weight ?? c?.weights?.manual_academic ?? 0),
    lang_boost_da: Number(c?.lang_boost_da ?? c?.weights?.lang_da ?? 0),
    domain_boost_dk: Number(c?.domain_boost_dk ?? c?.weights?.domain_dk ?? 0),
  }));

  // 2) Beregn scoring via central scorer (læser α/β fra retrieval_config)
  const res = await applyAcademicDanishScoring(
    supabase,
    raw,
    ownerId ?? null,
    { topN: topK, joiner: "\n\n---\n\n" }
  );

  // 3) Returnér i stabil form
  return {
    rankedText: res.rankedText,
    candidates: res.ranked,
    weights: {
      alpha: res.alpha,
      beta: res.beta,
      mLang: res.mLang,
      mDomain: res.mDomain,
    },
  };
}

