// lib/grading/danish7.ts
export type Danish7Grade = "-3" | "00" | "02" | "4" | "7" | "10" | "12";

/** score100 forventes 0..100 */
export function scoreToDanish7(score100: number): Danish7Grade {
  const s = Number.isFinite(score100) ? Math.max(0, Math.min(100, Math.round(score100))) : 0;

  if (s >= 92) return "12";
  if (s >= 80) return "10";
  if (s >= 67) return "7";
  if (s >= 52) return "4";
  if (s >= 40) return "02";
  if (s >= 20) return "00";
  return "-3";
}

export function formatDanish7(g: Danish7Grade): string {
  return g; // allerede korrekt "00"/"02"
}

/**
 * Et “ankerscore” pr. karakter (0..100).
 * Bruges til at lave matematik på karakterer, og konverteres tilbage med scoreToDanish7().
 * Midtpunkter i dine nuværende score-intervaller:
 * 12: 92-100 => 96, 10: 80-91 => 86, 7: 67-79 => 73, 4: 52-66 => 59,
 * 02: 40-51 => 46, 00: 20-39 => 30, -3: 0-19 => 10
 */
const GRADE_TO_SCORE: Record<Danish7Grade, number> = {
  "12": 96,
  "10": 86,
  "7": 73,
  "4": 59,
  "02": 46,
  "00": 30,
  "-3": 10,
};

export function danish7ToScore100(g: Danish7Grade): number {
  return GRADE_TO_SCORE[g];
}

export const DANISH7_ORDER: Danish7Grade[] = ["-3", "00", "02", "4", "7", "10", "12"];

export function downgradeOneStep(g: Danish7Grade): Danish7Grade {
  const idx = DANISH7_ORDER.indexOf(g);
  return idx <= 0 ? g : DANISH7_ORDER[idx - 1];
}
