export type SamfundTrainerTaskType =
  | "samfund_redegoer_analyser"
  | "samfund_vurder_losning"
  | "samfund_diskuter_konsekvenser";

type SamfundIssueDefault = {
  category: string;
  title: string;
  diagnosis: string;
  why_it_matters: string;
  repair: string;
  example?: string;
};

const SAMFUND_CONTEXT_RE =
  /\b(samfund|samfundsfag|politik|politiske|velfærd|velfaerd|velfærdsstat|velfaerdsstat|offentlige finanser|offentlige udgifter|skatter|skat|besparelser|omfordeling|solidaritet|individuelt ansvar|arbejdsmarked|offentlig sektor|statens udgifter|statens indtaegter|samfundsøkonomi|samfundsokonomi)\b/i;

const SAMFUND_ISSUE_DEFAULTS: Record<string, SamfundIssueDefault> = {
  samfund_choice_not_clear: {
    category: "vurdering",
    title: "Valget mellem politiske muligheder står ikke tydeligt nok",
    diagnosis: "Du nævner flere politiske muligheder, men det bliver ikke tydeligt, hvilken løsning du selv peger på som mest holdbar.",
    why_it_matters: "I samfundsfag trækker det ned, hvis vurderingen bliver refererende i stedet for at munde ud i et tydeligt valg eller standpunkt.",
    repair: "Gør det tydeligt, hvilken politisk løsning du vurderer som mest holdbar, og begrund valget kort med faglige argumenter.",
    example: "Skriv fx, hvilken løsning du vælger, og knyt den til 1-2 konsekvenser for statens prioriteringer eller borgernes ansvar.",
  },
  samfund_consequences_not_unfolded: {
    category: "konsekvenser",
    title: "Konsekvenserne bliver ikke foldet tydeligt nok ud",
    diagnosis: "Du peger på en løsning eller retning, men du udfolder ikke tydeligt, hvilke konsekvenser den kan få.",
    why_it_matters: "I samfundsfag skal vurderinger ofte vise, hvad valgene betyder for fx offentlige finanser, prioriteringer eller fordelingen mellem stat og individ.",
    repair: "Fold konsekvenserne tydeligere ud, især for offentlige finanser, prioriteringer og forholdet mellem solidaritet og individuelt ansvar.",
    example: "Vis fx, hvordan en løsning kan påvirke statens udgifter, skatteniveau eller presset på velfærdsydelserne.",
  },
  samfund_begrebsbrug_imprecise: {
    category: "begrebsbrug",
    title: "De samfundsfaglige begreber bruges ikke præcist nok",
    diagnosis: "Du nævner samfundsfaglige begreber, men de bliver enten for løst brugt eller ikke forklaret tydeligt i sammenhængen.",
    why_it_matters: "Præcis begrebsbrug gør det tydeligt, at du forstår de samfundsfaglige mekanismer og ikke kun gengiver teksten overfladisk.",
    repair: "Brug færre begreber, men forklar dem mere præcist og knyt dem direkte til din analyse eller vurdering.",
    example: "Forklar fx kort, hvad solidaritet, omfordeling eller offentlige finanser betyder i netop denne sammenhæng.",
  },
  samfund_analysis_too_descriptive: {
    category: "analyse",
    title: "Analysen bliver for beskrivende",
    diagnosis: "Du gengiver pointer fra materialet, men du får ikke tydeligt vist, hvordan de hænger sammen, eller hvad de betyder analytisk.",
    why_it_matters: "En samfundsfaglig analyse skal gå videre end redegørelse og vise sammenhænge, årsager eller konflikter mellem interesser og løsninger.",
    repair: "Løft svaret fra redegørelse til analyse ved at vise sammenhænge mellem aktører, interesser, økonomi og politiske valg.",
    example: "Vis fx, hvordan demografi, globalisering og offentlige udgifter hænger sammen i presset på velfærdsstaten.",
  },
  samfund_vurdering_not_explicit: {
    category: "vurdering",
    title: "Vurderingen står ikke tydeligt nok",
    diagnosis: "Du kommer tæt på en vurdering, men den bliver ikke formuleret som et klart fagligt standpunkt.",
    why_it_matters: "Når vurderingen er uklar, er det svært at se, hvordan du selv vejer muligheder, konsekvenser og modargumenter op mod hinanden.",
    repair: "Afslut tydeligere med din egen vurdering og gør kort rede for, hvorfor du vægter nogle hensyn højere end andre.",
    example: "Skriv fx direkte, hvilken løsning du vurderer som mest holdbar, og hvorfor dens fordele vejer tungere end alternativerne.",
  },
  samfund_modargument_missing: {
    category: "diskussion",
    title: "Modargumenter eller alternative hensyn mangler",
    diagnosis: "Du fremhæver én retning, men du viser ikke tydeligt, hvilke modargumenter eller modsatrettede hensyn der også kan tale imod den.",
    why_it_matters: "Diskussion i samfundsfag bliver stærkere, når du viser, at valget står mellem reelle hensyn og ikke kun én oplagt løsning.",
    repair: "Tag mindst ét modargument eller alternativt hensyn med, og forklar kort hvorfor du stadig lander på din vurdering.",
    example: "Nævn fx hvad man kan vinde eller miste ved at udvide, fastholde eller reducere den offentlige sektor.",
  },
};

function normalizeQuestionText(question: string) {
  return question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "aa");
}

export function inferSamfundTrainerTask(question: string): SamfundTrainerTaskType | null {
  const text = normalizeQuestionText(question);
  if (!SAMFUND_CONTEXT_RE.test(text)) return null;

  const scores: Record<SamfundTrainerTaskType, number> = {
    samfund_redegoer_analyser: 0,
    samfund_vurder_losning: 0,
    samfund_diskuter_konsekvenser: 0,
  };

  if (/\bredegor\b|\bredegor for\b|\bforklar\b/.test(text)) scores.samfund_redegoer_analyser += 4;
  if (/\banalyser\b|\banalyse\b/.test(text)) scores.samfund_redegoer_analyser += 4;
  if (/\bvurder\b/.test(text)) scores.samfund_vurder_losning += 4;
  if (/\bvaelg\b|\bvalg\b/.test(text)) scores.samfund_vurder_losning += 4;
  if (/\bbegrund\b/.test(text)) scores.samfund_vurder_losning += 3;
  if (/\blosning\b|\blosninger\b|\bmulighed\b|\bmuligheder\b/.test(text)) scores.samfund_vurder_losning += 2;
  if (/\bdiskuter\b/.test(text)) scores.samfund_diskuter_konsekvenser += 4;
  if (/\bkonsekvens\b|\bkonsekvenser\b/.test(text)) scores.samfund_diskuter_konsekvenser += 4;
  if (/\boffentlige finanser\b|\boffentlige udgifter\b|\bindtaegter\b|\bskatter\b|\bbesparelser\b/.test(text)) {
    scores.samfund_diskuter_konsekvenser += 3;
  }

  const ranked = (Object.entries(scores) as Array<[SamfundTrainerTaskType, number]>)
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score > 0);

  if (!ranked.length) return null;
  return ranked[0][0];
}

export function buildSamfundTrainerPromptAddendum(taskType: SamfundTrainerTaskType) {
  const taskSpecificGuidance =
    taskType === "samfund_redegoer_analyser"
      ? [
          "- Spørgsmålet kræver primært redegørelse og analyse: skeln tydeligt mellem hvad eleven redegør for, og hvad eleven faktisk analyserer.",
          "- Hvis svaret mest genfortæller materialet uden at vise sammenhænge, så brug koden \"samfund_analysis_too_descriptive\".",
        ]
      : taskType === "samfund_vurder_losning"
        ? [
            "- Spørgsmålet kræver et valg eller en vurdering mellem politiske muligheder.",
            "- Vurder om eleven faktisk vælger en løsning, gør valget tydeligt og begrunder det kort.",
            "- Hvis valget er uklart, så brug koden \"samfund_choice_not_clear\" eller \"samfund_vurdering_not_explicit\".",
          ]
        : [
            "- Spørgsmålet kræver diskussion eller vurdering af konsekvenser.",
            "- Vurder om eleven folder konsekvenserne ud, især for offentlige finanser, skatter, prioriteringer og spændingen mellem solidaritet og individuelt ansvar.",
            "- Hvis konsekvenserne kun nævnes løst, så brug koden \"samfund_consequences_not_unfolded\".",
          ];

  return [
    "",
    "Samfundsfagligt vurderingsspor:",
    "- Skeln eksplicit mellem redegørelse, analyse, vurdering og diskussion. Kritiser kun det niveau, som spørgsmålet faktisk kræver.",
    "- Vurder om samfundsfaglige begreber bruges præcist og i den rigtige sammenhæng.",
    "- Vurder om eleven nøjes med at referere materialet, eller faktisk analyserer og tager faglig stilling.",
    "- Se især efter om eleven:",
    "  - vælger mellem politiske muligheder, når spørgsmålet lægger op til det",
    "  - begrunder valget med samfundsfaglige argumenter",
    "  - folder konsekvenser for offentlige finanser og prioriteringer ud, når det er relevant",
    "  - inddrager modargumenter eller modsatrettede hensyn i en diskussion, når det er relevant",
    "- Brug helst disse issue-koder, når de passer:",
    "  - samfund_choice_not_clear",
    "  - samfund_consequences_not_unfolded",
    "  - samfund_begrebsbrug_imprecise",
    "  - samfund_analysis_too_descriptive",
    "  - samfund_vurdering_not_explicit",
    "  - samfund_modargument_missing",
    ...taskSpecificGuidance,
  ].join("\n");
}

export function getSamfundIssueDefaults(code: string): SamfundIssueDefault | null {
  return SAMFUND_ISSUE_DEFAULTS[code] ?? null;
}
