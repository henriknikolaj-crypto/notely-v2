export type OkonomiTrainerTaskType =
  | "okonomi_forklar_sammenhaeng"
  | "okonomi_vurder_case_eller_tiltag"
  | "okonomi_beregn_og_fortolk";

type OkonomiIssueDefault = {
  category: string;
  title: string;
  diagnosis: string;
  why_it_matters: string;
  repair: string;
  example?: string;
};

const OKONOMI_CONTEXT_RE =
  /\b(okonomi|oekonomi|marked|markeder|rente|inflation|vaekst|vækst|efterspoergsel|efterspørgsel|udbud|elasticitet|daekningsbidrag|dækningsbidrag|avance|nulpunkt|omsaetning|omsætning|omkostninger|indekstal|noegletal|nøgletal|konjunktur|konkurrenceevne|pris|omkostning)\b/i;

const OKONOMI_ISSUE_DEFAULTS: Record<string, OkonomiIssueDefault> = {
  okonomi_sammenhaeng_for_uklar: {
    category: "sammenhaeng",
    title: "Den økonomiske sammenhæng er for uklar",
    diagnosis: "Du nævner flere økonomiske forhold, men forklarer ikke tydeligt nok, hvordan de hænger sammen.",
    why_it_matters: "I økonomi skal forklaringer vise en tydelig kæde mellem årsag, virkning og økonomisk konsekvens.",
    repair: "Forklar tydeligere hvordan ét økonomisk forhold påvirker det næste, og afslut med den samlede konsekvens.",
    example: "Vis fx hvordan ændret rente påvirker efterspørgsel, investeringer og vækst i den konkrete sammenhæng.",
  },
  okonomi_begreb_brugt_for_loest: {
    category: "begrebsbrug",
    title: "Begreberne bruges for løst",
    diagnosis: "Du nævner økonomiske begreber, men de bliver ikke anvendt præcist nok i forhold til casen eller opgaven.",
    why_it_matters: "Økonomiske begreber skal bruges korrekt, så det bliver tydeligt at du forstår mekanismen og ikke kun nævner et nøgleord.",
    repair: "Brug færre begreber, men anvend dem mere præcist og knyt dem direkte til den konkrete økonomiske situation.",
    example: "Forklar fx kort hvad elasticitet, dækningsbidrag eller inflation betyder i netop denne case.",
  },
  okonomi_arsag_virkning_ikke_udfoldet: {
    category: "arsag_virkning",
    title: "Årsag og virkning er ikke foldet tydeligt ud",
    diagnosis: "Du peger på en mulig effekt, men viser ikke tydeligt nok hele kæden fra årsag til virkning.",
    why_it_matters: "Når årsag og virkning ikke foldes ud, bliver økonomiske forklaringer for korte og mister faglig tyngde.",
    repair: "Fold kæden tydeligere ud fra årsag til virkning og videre til den økonomiske konsekvens.",
    example: "Skriv fx hvad der sætter udviklingen i gang, hvad det påvirker først, og hvilke videre konsekvenser det får.",
  },
  okonomi_vurdering_for_uudtalt: {
    category: "vurdering",
    title: "Vurderingen er for uudtalt",
    diagnosis: "Du nævner mulige løsninger eller konsekvenser, men gør ikke tydeligt hvad du samlet vurderer.",
    why_it_matters: "I økonomiopgaver med tiltag eller cases er det vigtigt at samle analysen i en tydelig vurdering.",
    repair: "Afslut tydeligere med din samlede vurdering og begrund kort hvorfor du vægter nogle økonomiske hensyn højere end andre.",
    example: "Skriv fx hvilken løsning eller hvilket tiltag du vurderer som mest hensigtsmæssigt, og hvorfor.",
  },
  okonomi_konsekvenser_for_korte: {
    category: "konsekvenser",
    title: "Konsekvenserne bliver for korte",
    diagnosis: "Du nævner en økonomisk konsekvens, men udfolder den ikke nok til at vise hvad den betyder i praksis.",
    why_it_matters: "Økonomiske konsekvenser skal ofte forbindes til virksomheder, forbrugere, stat, marked eller nøgletal for at blive fagligt overbevisende.",
    repair: "Udfold konsekvenserne mere konkret og vis hvem eller hvad der bliver påvirket økonomisk.",
    example: "Forklar fx hvad et tiltag betyder for omsætning, omkostninger, vækst, inflation eller konkurrenceevne.",
  },
  okonomi_case_kobling_for_svag: {
    category: "case",
    title: "Koblingen til casen er for svag",
    diagnosis: "Du bruger teori eller begreber, men de bliver ikke tydeligt koblet til den konkrete case eller situation.",
    why_it_matters: "I økonomi skal teori ofte bruges aktivt på en konkret virksomhed, et marked eller en økonomisk situation.",
    repair: "Knyt teorien tættere til casen og vis konkret hvordan tallene, markedet eller beslutningen passer til begrebet.",
    example: "Brug fx et konkret tal eller et forhold fra casen, når du forklarer hvorfor teorien passer her.",
  },
  okonomi_beregning_uden_fortolkning: {
    category: "fortolkning",
    title: "Beregningen bliver ikke fortolket",
    diagnosis: "Du finder et økonomisk tal eller nøgletal, men forklarer ikke tydeligt hvad resultatet betyder.",
    why_it_matters: "I økonomi tæller det ikke kun at regne et tal ud; du skal også vise hvad det siger om virksomheden, markedet eller udviklingen.",
    repair: "Forklar kort hvad resultatet betyder, og brug tallet aktivt i din argumentation eller vurdering.",
    example: "Skriv fx hvad et dækningsbidrag, et indekstal eller et nøgletal fortæller om udviklingen i casen.",
  },
  okonomi_mellemregninger_mangler: {
    category: "mellemregninger",
    title: "Mellemregningerne mangler",
    diagnosis: "Du springer for hurtigt fra formler eller tal til resultatet, så beregningen ikke kan følges sikkert.",
    why_it_matters: "Når mellemregninger mangler, er det svært at se metode, kontrollere tallene og bruge resultatet sikkert videre.",
    repair: "Vis mellemregningerne tydeligere i de trin, hvor du indsætter tal, omformer eller regner videre.",
    example: "Skriv fx mellemregningen mellem opstilling og slutresultat, så hvert trin kan følges.",
  },
  okonomi_resultat_ikke_anvendt_i_argument: {
    category: "argumentation",
    title: "Resultatet bliver ikke brugt i argumentationen",
    diagnosis: "Du finder et relevant økonomisk resultat, men bruger det ikke aktivt i din forklaring eller vurdering.",
    why_it_matters: "Et økonomisk tal får først faglig værdi, når det bliver koblet til en pointe, en konsekvens eller en anbefaling.",
    repair: "Brug resultatet direkte i din argumentation og forklar hvad det betyder for den konklusion du når frem til.",
    example: "Vis fx hvordan dit resultat støtter din vurdering af et marked, en virksomhed eller et økonomisk tiltag.",
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

export function inferOkonomiTrainerTask(question: string): OkonomiTrainerTaskType | null {
  const text = normalizeQuestionText(question);
  if (!OKONOMI_CONTEXT_RE.test(text)) return null;

  const scores: Record<OkonomiTrainerTaskType, number> = {
    okonomi_forklar_sammenhaeng: 0,
    okonomi_vurder_case_eller_tiltag: 0,
    okonomi_beregn_og_fortolk: 0,
  };

  if (/\bforklar\b|\bredegoer\b|\banalyser\b|\bmarked\b|\brente\b|\binflation\b|\bvaekst\b|\befterspoergsel\b|\budbud\b/.test(text)) {
    scores.okonomi_forklar_sammenhaeng += 4;
  }
  if (/\bvurder\b|\bdiskuter\b|\bkonsekvenser\b|\bcase\b|\btiltag\b/.test(text)) {
    scores.okonomi_vurder_case_eller_tiltag += 4;
  }
  if (/\bberegn\b|\bregn\b|\belasticitet\b|\bdaekningsbidrag\b|\bavance\b|\bnulpunkt\b|\bomsaetning\b|\bomkostninger\b|\bindekstal\b|\bnoegletal\b/.test(text)) {
    scores.okonomi_beregn_og_fortolk += 4;
  }
  if (/\bfortolk\b|\bforklar hvad\b/.test(text)) scores.okonomi_beregn_og_fortolk += 2;

  const ranked = (Object.entries(scores) as Array<[OkonomiTrainerTaskType, number]>)
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score > 0);

  if (!ranked.length) return null;
  return ranked[0][0];
}

export function buildOkonomiTrainerPromptAddendum(taskType: OkonomiTrainerTaskType) {
  const taskSpecificGuidance =
    taskType === "okonomi_forklar_sammenhaeng"
      ? [
          "- Spørgsmålet kræver forklaring af en økonomisk sammenhæng.",
          "- Vurder om eleven går fra årsag til virkning og videre til økonomisk konsekvens i stedet for kun at nævne begreber.",
          "- Hvis sammenhængen bliver for uklar, så brug koden \"okonomi_sammenhaeng_for_uklar\" eller \"okonomi_arsag_virkning_ikke_udfoldet\".",
        ]
      : taskType === "okonomi_vurder_case_eller_tiltag"
        ? [
            "- Spørgsmålet kræver vurdering af en case, et marked eller et økonomisk tiltag.",
            "- Vurder om eleven faktisk samler op i en begrundet vurdering og kobler teori til den konkrete case.",
            "- Hvis case-koblingen er for svag, så brug koden \"okonomi_case_kobling_for_svag\".",
          ]
        : [
            "- Spørgsmålet kræver beregning og fortolkning af økonomiske tal eller nøgletal.",
            "- Vurder om eleven både viser mellemregninger og forklarer hvad resultatet betyder økonomisk.",
            "- Hvis resultatet ikke bliver fortolket, så brug koden \"okonomi_beregning_uden_fortolkning\".",
          ];

  return [
    "",
    "Økonomifagligt vurderingsspor:",
    "- Vær konkret og forholdsvis kort i feedbacken.",
    "- Skeln mellem begreb nævnt og begreb anvendt korrekt.",
    "- Skeln mellem årsag nævnt og årsag/virkning faktisk udfoldet.",
    "- Skeln mellem vurdering nævnt og vurdering faktisk begrundet.",
    "- Hvis der er tal, så vurder både beregningen og om resultatet bliver fortolket og brugt i argumentationen.",
    "- Brug helst disse issue-koder, når de passer:",
    "  - okonomi_sammenhaeng_for_uklar",
    "  - okonomi_begreb_brugt_for_loest",
    "  - okonomi_arsag_virkning_ikke_udfoldet",
    "  - okonomi_vurdering_for_uudtalt",
    "  - okonomi_konsekvenser_for_korte",
    "  - okonomi_case_kobling_for_svag",
    "  - okonomi_beregning_uden_fortolkning",
    "  - okonomi_mellemregninger_mangler",
    "  - okonomi_resultat_ikke_anvendt_i_argument",
    ...taskSpecificGuidance,
  ].join("\n");
}

export function getOkonomiIssueDefaults(code: string): OkonomiIssueDefault | null {
  return OKONOMI_ISSUE_DEFAULTS[code] ?? null;
}
