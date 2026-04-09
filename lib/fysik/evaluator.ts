export type FysikTrainerTaskType =
  | "fysik_beregn_og_forklar"
  | "fysik_fortolk_resultat"
  | "fysik_modellering_eller_antagelse";

type FysikIssueDefault = {
  category: string;
  title: string;
  diagnosis: string;
  why_it_matters: string;
  repair: string;
  example?: string;
};

const FYSIK_CONTEXT_RE =
  /\b(fysik|kraft|energi|effekt|spaending|stroem|felt|acceleration|hastighed|temperatur|tryk|graf|maaling|model|forsoeg|usikkerhed|enhed|enheder|antagelse|modstand|boelge|frekvens|ladning|spole|varme)\b/i;

const FYSIK_ISSUE_DEFAULTS: Record<string, FysikIssueDefault> = {
  fysik_begreb_for_loest: {
    category: "begrebsbrug",
    title: "Det fysiske begreb bruges for løst",
    diagnosis: "Du nævner et fysisk begreb, men det bliver ikke brugt præcist nok i den konkrete sammenhæng.",
    why_it_matters: "I fysik er præcis begrebsbrug vigtig, fordi små nuancer kan ændre forklaringen eller tolkningen af resultatet.",
    repair: "Brug begrebet mere præcist og knyt det direkte til den fysiske situation i opgaven.",
    example: "Forklar fx kort hvad kraft, effekt eller spænding betyder netop i denne model eller måling.",
  },
  fysik_metode_ikke_tydelig: {
    category: "metode",
    title: "Metoden er ikke tydelig nok",
    diagnosis: "Du kommer frem til et resultat, men det er ikke tydeligt nok, hvilke fysiske sammenhænge, formler eller trin du bruger undervejs.",
    why_it_matters: "I fysik tæller det, at man kan vise sin opstilling og metode, ikke kun ende på et tal.",
    repair: "Gør opstilling og metode tydeligere, og vis hvilke formler eller trin du bruger for at nå frem til resultatet.",
    example: "Skriv fx hvilket fysisk princip eller hvilken formel der forbinder de størrelser, du regner med.",
  },
  fysik_resultat_ikke_fortolket: {
    category: "fortolkning",
    title: "Resultatet bliver ikke fortolket fysisk",
    diagnosis: "Du finder et resultat, men forklarer ikke tydeligt hvad det betyder i den fysiske sammenhæng.",
    why_it_matters: "Et fysikresultat bliver først fagligt stærkt, når det bliver tolket og koblet til situationen, modellen eller forsøget.",
    repair: "Forklar kort hvad resultatet betyder fysisk, og hvordan det hænger sammen med opgaven, grafen eller forsøget.",
    example: "Skriv fx hvad værdien siger om bevægelsen, energien eller kredsløbet i den konkrete situation.",
  },
  fysik_enhed_mangler_eller_usikker: {
    category: "enheder",
    title: "Enheden mangler eller er usikker",
    diagnosis: "Resultatet eller størrelserne er ikke angivet med tydelig og korrekt enhed.",
    why_it_matters: "I fysik er enheder en del af selve svaret og hjælper med at kontrollere om beregningen giver fysisk mening.",
    repair: "Skriv enhed på resultatet og hold notation og størrelser konsekvente gennem løsningen.",
    example: "Angiv fx om resultatet er i N, J, W, V, A eller en anden relevant enhed.",
  },
  fysik_antagelse_ikke_udtalt: {
    category: "modellering",
    title: "Antagelsen eller modellen bliver ikke udtalt",
    diagnosis: "Du bruger en model eller forenkling, men gør ikke tydeligt hvilke antagelser løsningen bygger på.",
    why_it_matters: "Fysikopgaver bygger ofte på idealiseringer, og svaret bliver stærkere når du viser hvilke antagelser der gælder.",
    repair: "Gør modellen eller antagelsen tydeligere, og nævn kort hvad den betyder for resultatet.",
    example: "Skriv fx hvis du ser bort fra luftmodstand, antager konstant acceleration eller bruger en idealiseret model.",
  },
  fysik_aarsag_virkning_for_uklar: {
    category: "forklaring",
    title: "Årsag og virkning er for uklare",
    diagnosis: "Du peger på en fysisk sammenhæng, men forklarer ikke tydeligt nok hvorfor én størrelse påvirker en anden.",
    why_it_matters: "I fysik er det vigtigt at vise den fysiske forklaring bag en formel eller en observeret effekt.",
    repair: "Fold sammenhængen tydeligere ud fra fysisk årsag til fysisk virkning.",
    example: "Forklar fx hvorfor ændret spænding, kraft eller temperatur fører til den observerede ændring.",
  },
  fysik_graf_eller_data_ikke_brugt: {
    category: "data",
    title: "Grafen eller data bliver ikke brugt tydeligt nok",
    diagnosis: "Du henviser til graf, målinger eller data, men bruger dem ikke aktivt nok i din forklaring eller konklusion.",
    why_it_matters: "Når data eller en graf indgår i fysik, skal de bruges som belæg for konklusionen og ikke kun nævnes overfladisk.",
    repair: "Brug grafen eller data mere aktivt som belæg, og peg på hvad de konkret viser.",
    example: "Henvis fx til en hældning, et punkt, en tendens eller en måleserie og forklar hvad det betyder fysisk.",
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

export function inferFysikTrainerTask(question: string): FysikTrainerTaskType | null {
  const text = normalizeQuestionText(question);
  if (!FYSIK_CONTEXT_RE.test(text)) return null;

  const scores: Record<FysikTrainerTaskType, number> = {
    fysik_beregn_og_forklar: 0,
    fysik_fortolk_resultat: 0,
    fysik_modellering_eller_antagelse: 0,
  };

  if (/\bberegn\b|\bbestem\b|\bvis\b|\bforklar\b|\bkraft\b|\benergi\b|\beffekt\b|\bspaending\b|\bstroem\b|\bacceleration\b|\bhastighed\b|\btryk\b/.test(text)) {
    scores.fysik_beregn_og_forklar += 4;
  }
  if (/\bgraf\b|\bmaaling\b|\bforsoeg\b|\bdata\b|\bresultat\b|\bforklar hvad\b/.test(text)) {
    scores.fysik_fortolk_resultat += 4;
  }
  if (/\bmodel\b|\bantagelse\b|\busikkerhed\b|\bbegrund\b|\bvurder\b/.test(text)) {
    scores.fysik_modellering_eller_antagelse += 4;
  }

  const ranked = (Object.entries(scores) as Array<[FysikTrainerTaskType, number]>)
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score > 0);

  if (!ranked.length) return null;
  return ranked[0][0];
}

export function buildFysikTrainerPromptAddendum(taskType: FysikTrainerTaskType) {
  const taskSpecificGuidance =
    taskType === "fysik_beregn_og_forklar"
      ? [
          "- Spørgsmålet kræver beregning og fysikforklaring.",
          "- Vurder både om eleven regner sig frem til noget relevant, og om eleven forklarer den fysiske betydning af metoden og resultatet.",
          "- Hvis metoden er for uklar, så brug koden \"fysik_metode_ikke_tydelig\".",
        ]
      : taskType === "fysik_fortolk_resultat"
        ? [
            "- Spørgsmålet kræver fortolkning af et resultat, en graf eller data.",
            "- Vurder om eleven bruger grafen eller data aktivt og forklarer hvad resultatet betyder fysisk, ikke kun aflæser eller gengiver.",
            "- Hvis resultatet ikke fortolkes, så brug koden \"fysik_resultat_ikke_fortolket\".",
          ]
        : [
            "- Spørgsmålet kræver modellering, antagelser eller vurdering af usikkerhed.",
            "- Vurder om eleven gør antagelserne tydelige og forklarer hvad de betyder for konklusionen.",
            "- Hvis antagelsen ikke nævnes, så brug koden \"fysik_antagelse_ikke_udtalt\".",
          ];

  return [
    "",
    "Fysikfagligt vurderingsspor:",
    "- Vær konkret og teknisk uden at blive unødigt teksttung.",
    "- Skeln mellem korrekt opstilling/metode og korrekt slutresultat.",
    "- Vurder om eleven forklarer den fysiske betydning af resultatet og ikke kun regner sig frem til et tal.",
    "- Vurder om begreber, enheder og størrelsesorden bruges præcist.",
    "- Vurder om graf, målinger eller data faktisk bruges som belæg i svaret.",
    "- Brug helst disse issue-koder, når de passer:",
    "  - fysik_begreb_for_loest",
    "  - fysik_metode_ikke_tydelig",
    "  - fysik_resultat_ikke_fortolket",
    "  - fysik_enhed_mangler_eller_usikker",
    "  - fysik_antagelse_ikke_udtalt",
    "  - fysik_aarsag_virkning_for_uklar",
    "  - fysik_graf_eller_data_ikke_brugt",
    ...taskSpecificGuidance,
  ].join("\n");
}

export function getFysikIssueDefaults(code: string): FysikIssueDefault | null {
  return FYSIK_ISSUE_DEFAULTS[code] ?? null;
}
