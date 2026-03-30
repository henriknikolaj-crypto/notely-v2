// lib/grading/sessionGrade.ts
import {
  Danish7Grade,
  danish7ToScore100,
  downgradeOneStep,
  scoreToDanish7,
} from "@/lib/grading/danish7";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function plannedQuestionsFromMinutes(minutes: number, paceMinPerQ = 3): number {
  const m = Math.max(1, Math.round(minutes));
  const pace = Math.max(1, paceMinPerQ);
  // 20->7, 30->10, 40->14, 60->20
  return Math.max(1, Math.ceil(m / pace));
}

type CalcArgs = {
  qualityGrade: Danish7Grade; // karakter ud fra kvalitet på besvarede
  answeredCount: number;      // antal bedømte spørgsmål
  minutes: number;            // 20/40/60 osv.
  paceMinPerQ?: number;       // default 3
  coverageWeight?: number;    // default 0.25
  forceDowngradeIfIncomplete?: boolean; // default true
};

export function calcSessionGrade({
  qualityGrade,
  answeredCount,
  minutes,
  paceMinPerQ = 3,
  coverageWeight = 0.25,
  forceDowngradeIfIncomplete = true,
}: CalcArgs) {
  const planned = plannedQuestionsFromMinutes(minutes, paceMinPerQ);
  const answered = Math.max(0, Math.round(answeredCount));
  const coverage = planned > 0 ? clamp(answered / planned, 0, 1) : 0;

  if (answered === 0) {
    return {
      plannedQuestions: planned,
      coverage,
      qualityGrade,
      qualityScore100: danish7ToScore100(qualityGrade),
      finalScore100: 0,
      finalGrade: null as Danish7Grade | null,
    };
  }

  const qualityScore100 = danish7ToScore100(qualityGrade);

  // 75% kvalitet + 25% dækning (dækning reducerer kun)
  const factor = (1 - coverageWeight) + coverageWeight * coverage; // 0.75..1.0
  const finalScore100 = clamp(qualityScore100 * factor, 0, 100);

  let finalGrade = scoreToDanish7(finalScore100);

  // Sørg for at ufuldstændig session kan “mærkes”, selv hvis rounding lander samme karakter
  if (forceDowngradeIfIncomplete && coverage < 1 && finalGrade === qualityGrade) {
    finalGrade = downgradeOneStep(finalGrade);
  }

  return {
    plannedQuestions: planned,
    coverage,
    qualityGrade,
    qualityScore100,
    finalScore100,
    finalGrade,
  };
}
