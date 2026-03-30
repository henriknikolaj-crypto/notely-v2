export type TrainerFeedbackSections = {
  overall: string;
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
};

export function buildTrainerFeedbackText(sections: TrainerFeedbackSections) {
  const overall = String(sections.overall ?? "").trim() || "Overordnet et fint, men kort svar.";
  const strengths = sections.strengths.filter(Boolean);
  const improvements = sections.improvements.filter(Boolean);
  const nextSteps = sections.nextSteps.filter(Boolean);

  return [
    `Samlet vurdering: ${overall}`,
    "",
    "Styrker:",
    ...strengths.map((s) => `- ${s}`),
    "",
    "Det kan forbedres:",
    ...improvements.map((s) => `- ${s}`),
    "",
    "Forslag til næste skridt:",
    ...nextSteps.map((s) => `- ${s}`),
  ].join("\n");
}
