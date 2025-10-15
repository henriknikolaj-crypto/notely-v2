export function generateQuestionPrompt(input: {
  topicHint?: string;
  mergedContext: string;
}) {
  const { topicHint, mergedContext } = input;

  return [
    {
      role: "system",
      content:
        "Du er en universitetscensor. Stil 1 klart afgrænset eksamensspørgsmål på dansk, der tester forståelse, ikke udenadslære.",
    },
    {
      role: "user",
      content: `
Kontekst (fra brugerens egne noter/uddrag):
"""
${mergedContext}
"""

${topicHint ? `Emne-hint: ${topicHint}` : ""}

Krav:
- Stil præcist 1 spørgsmål, ikke flere.
- Brug klare fagtermer, ingen fluff.
- Kun spørgsmåls-sætningen i svaret, ingen forklaringer eller punktopstilling.
      `.trim(),
    },
  ] as const;
}
