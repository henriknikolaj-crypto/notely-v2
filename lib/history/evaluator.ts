export type HistoryTrainerTaskType =
  | "history_kildeanalyse"
  | "history_aarsag_virkning"
  | "history_sammenligning";

type HistoryIssueDefault = {
  category: string;
  title: string;
  diagnosis: string;
  why_it_matters: string;
  repair: string;
  example?: string;
};

const HISTORY_CONTEXT_RE =
  /\b(history|historie|kilde|kildeanalyse|historisk|periode|epoke|aktør|aktoer|årsag|aarsag|virkning|konsekvens|sammenlign|sammenligning|fortid|revolution|krig|industrialiser|imperialisme)\b/i;

const HISTORY_ISSUE_DEFAULTS: Record<string, HistoryIssueDefault> = {
  history_analysis_too_referential: {
    category: "analyse",
    title: "Svaret bliver for refererende",
    diagnosis: "Du gengiver stoffet eller kilden, men viser ikke tydeligt, hvad det betyder analytisk.",
    why_it_matters: "I historie skal analysen gå videre end referat og vise, hvad materialet fortæller om sammenhænge, perspektiver eller historiske problemstillinger.",
    repair: "Løft svaret fra gengivelse til analyse ved at forklare, hvad stoffet eller kilden viser, og hvorfor det er vigtigt.",
    example: "Forklar fx ikke kun hvad kilden siger, men hvad den kan bruges til at forstå om perioden eller konflikten.",
  },
  history_source_used_without_interpretation: {
    category: "kildebrug",
    title: "Kilden bruges uden tydelig tolkning",
    diagnosis: "Du inddrager kilden, men du forklarer ikke tydeligt dens betydning, synsvinkel eller begrænsninger.",
    why_it_matters: "Historisk kildebrug bliver stærkere, når du viser, hvordan kilden kan tolkes, og hvad man skal være varsom med.",
    repair: "Tolk kilden tydeligere ved at forklare, hvad den viser, og hvilke begrænsninger eller vinkler den har.",
    example: "Skriv fx hvad kilden kan bruges til, og hvad man ikke uden videre kan konkludere ud fra den.",
  },
  history_context_missing: {
    category: "kontekst",
    title: "Den historiske kontekst mangler",
    diagnosis: "Du arbejder med emnet eller kilden, men placerer det ikke tydeligt i den relevante historiske sammenhæng.",
    why_it_matters: "Historiefaglige svar bliver stærkere, når de viser, hvordan en begivenhed eller kilde hænger sammen med perioden og dens udvikling.",
    repair: "Placér emnet tydeligere i den historiske kontekst og vis, hvilken periode, udvikling eller konflikt det indgår i.",
    example: "Knyt fx kilden til en bestemt periode og forklar kort, hvilke forhold der præger den.",
  },
  history_causation_not_explained: {
    category: "aarsag_virkning",
    title: "Årsag og virkning forklares ikke tydeligt nok",
    diagnosis: "Du nævner årsager eller konsekvenser, men du viser ikke klart, hvordan de hænger sammen.",
    why_it_matters: "Historie kræver ofte, at du forklarer sammenhænge mellem forudsætninger, begivenheder og følger.",
    repair: "Forklar tydeligere, hvordan årsager fører til bestemte virkninger eller konsekvenser.",
    example: "Vis fx hvordan en politisk beslutning eller krise skaber en bestemt udvikling over tid.",
  },
  history_comparison_missing: {
    category: "sammenligning",
    title: "Sammenligningen er for svag",
    diagnosis: "Du nævner flere perioder eller aktører, men sammenligner dem ikke tydeligt.",
    why_it_matters: "En tydelig sammenligning gør det lettere at se forskelle, ligheder og udviklinger i historien.",
    repair: "Sammenlign perioder eller aktører mere direkte og gør det tydeligt, hvad der er den vigtigste forskel eller lighed.",
    example: "Skriv fx hvordan to perioder eller aktører adskiller sig i mål, midler eller historisk betydning.",
  },
  history_concepts_imprecise: {
    category: "begrebsbrug",
    title: "Historiske begreber bruges for løst",
    diagnosis: "Du bruger historiske begreber, men de bliver ikke anvendt præcist eller analytisk nok.",
    why_it_matters: "Præcis begrebsbrug viser, at du forstår stoffet og kan bruge faget aktivt i din analyse.",
    repair: "Brug færre begreber, men forklar dem mere præcist og anvend dem direkte på kilden eller emnet.",
    example: "Forklar fx kort hvad et begreb betyder i denne sammenhæng, før du bruger det analytisk.",
  },
  history_conclusion_not_synthesizing: {
    category: "konklusion",
    title: "Konklusionen samler ikke argumentet tydeligt",
    diagnosis: "Du afrunder svaret, men konklusionen viser ikke klart, hvad dine vigtigste pointer samlet betyder.",
    why_it_matters: "En god historisk konklusion binder analysen sammen og gør det tydeligt, hvad du faktisk har vist.",
    repair: "Afslut med en kort konklusion, der samler de vigtigste argumenter og svarer tydeligt på spørgsmålet.",
    example: "Saml fx op på, hvad kilden eller udviklingen viser, og hvorfor det er historisk vigtigt.",
  },
};

function normalizeQuestionText(question: string) {
  return question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa");
}

export function inferHistoryTrainerTask(question: string): HistoryTrainerTaskType | null {
  const text = normalizeQuestionText(question);
  if (!HISTORY_CONTEXT_RE.test(text)) return null;

  const scores: Record<HistoryTrainerTaskType, number> = {
    history_kildeanalyse: 0,
    history_aarsag_virkning: 0,
    history_sammenligning: 0,
  };

  if (/\bkilde\b|\bkildeanalyse\b|\bbrug kilden\b|\banalyser kilden\b|\btolk kilden\b/.test(text)) {
    scores.history_kildeanalyse += 5;
  }
  if (/\bårsag\b|\baarsag\b|\bvirkning\b|\bkonsekvens\b|\bforlob\b|\budvikling\b/.test(text)) {
    scores.history_aarsag_virkning += 4;
  }
  if (/\bsammenlign\b|\bsammenligning\b|\bforskelle\b|\bligheder\b|\bperioder\b|\baktorer\b|\baktoerer\b/.test(text)) {
    scores.history_sammenligning += 4;
  }
  if (/\banalyser\b|\bfortolk\b|\bdiskuter\b|\bvurder\b/.test(text)) {
    scores.history_kildeanalyse += 2;
    scores.history_aarsag_virkning += 1;
  }

  const ranked = (Object.entries(scores) as Array<[HistoryTrainerTaskType, number]>)
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score > 0);

  if (!ranked.length) return null;
  return ranked[0][0];
}

export function buildHistoryTrainerPromptAddendum(taskType: HistoryTrainerTaskType) {
  const taskSpecificGuidance =
    taskType === "history_kildeanalyse"
      ? [
          "- Spørgsmålet kræver kildeanalyse: vurder om eleven tolker kilden og ikke kun gengiver den.",
          "- Se efter om eleven forklarer kildens synsvinkel, betydning og begrænsninger.",
          '- Hvis kilden bruges uden tydelig tolkning, så brug koden "history_source_used_without_interpretation".',
        ]
      : taskType === "history_aarsag_virkning"
        ? [
            "- Spørgsmålet kræver forklaring af årsag og virkning.",
            "- Vurder om eleven forklarer sammenhængen mellem årsager, udvikling og konsekvenser i stedet for bare at nævne dem.",
            '- Hvis sammenhængen ikke foldes ud, så brug koden "history_causation_not_explained".',
          ]
        : [
            "- Spørgsmålet kræver sammenligning mellem perioder, aktører eller udviklinger.",
            "- Vurder om eleven gør ligheder og forskelle tydelige og bruger sammenligningen analytisk.",
            '- Hvis sammenligningen bliver for løs, så brug koden "history_comparison_missing".',
          ];

  return [
    "",
    "Historiefagligt vurderingsspor:",
    "- Skeln tydeligt mellem referat, analyse og tolkning.",
    "- Vurder om eleven faktisk analyserer materialet eller bare gengiver det.",
    "- Vurder om kilder bruges med tolkning, betydning og begrænsninger, ikke kun som løst belæg.",
    "- Vurder om emnet placeres i en tydelig historisk kontekst.",
    "- Vurder om årsag, virkning og sammenhæng forklares tydeligt, når det er relevant.",
    "- Vurder om perioder eller aktører sammenlignes klart, når opgaven lægger op til det.",
    "- Vurder om historiske begreber bruges præcist og analytisk.",
    "- Vurder om konklusionen samler argumentet og ikke kun gentager enkeltpointer.",
    "- Brug helst disse issue-koder, når de passer:",
    "  - history_analysis_too_referential",
    "  - history_source_used_without_interpretation",
    "  - history_context_missing",
    "  - history_causation_not_explained",
    "  - history_comparison_missing",
    "  - history_concepts_imprecise",
    "  - history_conclusion_not_synthesizing",
    ...taskSpecificGuidance,
  ].join("\n");
}

export function getHistoryIssueDefaults(code: string): HistoryIssueDefault | null {
  return HISTORY_ISSUE_DEFAULTS[code] ?? null;
}
