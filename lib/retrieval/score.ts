// /lib/retrieval/score.ts
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

async function loadConfig(
  supabase: SupabaseClient,
  ownerId?: string | null
): Promise<{ alpha: number; beta: number; mLang: number; mDomain: number }> {
  // defaults (samme som i admin-SQL)
  let alpha = 0.25;
  let beta = 0.15;
  let mLang = 0.10;
  let mDomain: number | null = null; // hvis null → brug beta

  try {
    // owner → global
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

    if (ownerCfg?.alpha != null) alpha = Number(ownerCfg.alpha);
    else if (globalCfg?.alpha != null) alpha = Number(globalCfg.alpha);

    if (ownerCfg?.beta != null) beta = Number(ownerCfg.beta);
    else if (globalCfg?.beta != null) beta = Number(globalCfg.beta);
  } catch {
    // behold defaults
  }

  // du kan evt. læse mLang/mDomain fra en tabel; for nu: mDomain = beta (matcher vores adminkørsel)
  const domainMultiplier = mDomain ?? beta;

  return { alpha, beta, mLang, mDomain: domainMultiplier };
}

function scoreOne(
  c: RankCandidate,
  p: { alpha: number; beta: number; mLang: number; mDomain: number }
): number {
  const { alpha, beta, mLang, mDomain } = p;

  // Samme formel som i admin-SQL
  // base fra semantisk lighed
  const base = alpha * (c.similarity ?? 0);

  // troværdighed: verified vs. manual
  const trust =
    (1 - alpha) * (beta * (c.verified_weight ?? 0) + (1 - beta) * (c.manual_academic_weight ?? 0));

  // locale boosts
  const locale = mDomain * (c.domain_boost_dk ?? 0) + mLang * (c.lang_boost_da ?? 0);

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

  ranked.sort((a, b) => (b.finalScore - a.finalScore) || (b.similarity - a.similarity));

  const topN = options?.topN ?? Math.min(8, ranked.length);
  const joiner = options?.joiner ?? "\n\n---\n\n";
  const rankedText = ranked.slice(0, topN).map((r) => r.text?.trim()).filter(Boolean).join(joiner);

  return {
    alpha: cfg.alpha,
    beta: cfg.beta,
    mLang: cfg.mLang,
    mDomain: cfg.mDomain,
    ranked,
    rankedText,
  };
}

