// lib/retrieval/score.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type RankCandidate = {
  id?: string;
  text: string;
  similarity: number;
  verified_weight: number;
  manual_academic_weight: number;
  domain_boost_dk: number;
  lang_boost_da: number;
};

export type RankResult = {
  alpha: number;
  beta: number;
  mLang: number;
  mDomain: number;
  ranked: Array<RankCandidate & { finalScore: number }>;
  rankedText: string;
};

function clamp01(x: unknown, fallback: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

async function loadConfig(
  supabase: SupabaseClient,
  ownerId?: string | null
): Promise<{ alpha: number; beta: number; mLang: number; mDomain: number }> {
  // defaults (samme som i admin-SQL)
  let alpha = 0.25;
  let beta = 0.15;

  const mLang = 0.10;
  const mDomain: number | null = null; // hvis null → brug beta

  try {
    const { data: ownerCfg } = await supabase
      .from("retrieval_config")
      .select("alpha,beta")
      .eq("owner_id", ownerId ?? "__no_owner__")
      .limit(1)
      .maybeSingle();

    const { data: globalCfg } = await supabase
      .from("retrieval_config")
      .select("alpha,beta")
      .is("owner_id", null)
      .limit(1)
      .maybeSingle();

    const rawAlpha = ownerCfg?.alpha ?? globalCfg?.alpha;
    const rawBeta = ownerCfg?.beta ?? globalCfg?.beta;

    if (rawAlpha != null) alpha = clamp01(rawAlpha, alpha);
    if (rawBeta != null) beta = clamp01(rawBeta, beta);
  } catch {
    // behold defaults
  }

  const domainMultiplier = mDomain ?? beta;
  return { alpha, beta, mLang, mDomain: domainMultiplier };
}

function scoreOne(
  c: RankCandidate,
  p: { alpha: number; beta: number; mLang: number; mDomain: number }
): number {
  const { alpha, beta, mLang, mDomain } = p;

  const sim = Number(c.similarity ?? 0) || 0;
  const verified = Number(c.verified_weight ?? 0) || 0;
  const manual = Number(c.manual_academic_weight ?? 0) || 0;
  const dk = Number(c.domain_boost_dk ?? 0) || 0;
  const da = Number(c.lang_boost_da ?? 0) || 0;

  // base fra semantisk lighed
  const base = alpha * sim;

  // troværdighed: verified vs. manual
  const trust = (1 - alpha) * (beta * verified + (1 - beta) * manual);

  // locale boosts
  const locale = mDomain * dk + mLang * da;

  return base + trust + locale;
}

export async function applyAcademicDanishScoring(
  supabase: SupabaseClient,
  candidates: RankCandidate[],
  ownerId?: string | null,
  options?: { topN?: number; joiner?: string }
): Promise<RankResult> {
  const cfg = await loadConfig(supabase, ownerId);

  const ranked = [...(candidates ?? [])].map((c) => ({
    ...c,
    finalScore: scoreOne(c, cfg),
  }));

  ranked.sort(
    (a, b) => b.finalScore - a.finalScore || (b.similarity ?? 0) - (a.similarity ?? 0)
  );

  const topN = options?.topN ?? Math.min(8, ranked.length);
  const joiner = options?.joiner ?? "\n\n---\n\n";
  const rankedText = ranked
    .slice(0, topN)
    .map((r) => r.text?.trim())
    .filter(Boolean)
    .join(joiner);

  return {
    alpha: cfg.alpha,
    beta: cfg.beta,
    mLang: cfg.mLang,
    mDomain: cfg.mDomain,
    ranked,
    rankedText,
  };
}
