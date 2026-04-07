export type DanskTrainerTaskType =
  | "dansk_fortolk_tekst"
  | "dansk_analyser_virkemidler"
  | "dansk_fortolk_og_dokumenter";

type DanskIssueDefault = {
  category: string;
  title: string;
  diagnosis: string;
  why_it_matters: string;
  repair: string;
  example?: string;
};

const DANSK_CONTEXT_RE =
  /\b(dansk|novelle|digt|lyrik|roman|uddrag|fortaeller|fortæller|synsvinkel|komposition|virkemidler|virkemiddel|sprog|symbolik|tema|motiv|tekstbelaeg|tekstbelæg|fortolk|perspektiv)\b/i;

const DANSK_ISSUE_DEFAULTS: Record<string, DanskIssueDefault> = {
  dansk_tekstbelaeg_for_svagt: {
    category: "tekstbelaeg",
    title: "Tekstbelægget er for svagt",
    diagnosis: "Du peger på en pointe, men den bliver ikke forankret tydeligt nok i konkrete tekststeder.",
    why_it_matters: "I dansk bliver analysen og fortolkningen mere troværdig, når du viser præcist, hvilke ord, formuleringer eller passager du bygger din læsning på.",
    repair: "Brug 1-2 korte tekststeder som belæg, og forklar kort hvordan de understøtter din pointe.",
    example: "Inddrag fx en formulering fra teksten og vis, hvad den antyder om fortæller, tema eller relationer.",
  },
  dansk_analyse_for_refererende: {
    category: "analyse",
    title: "Analysen bliver for refererende",
    diagnosis: "Du gengiver, hvad der sker i teksten, men du forklarer ikke tydeligt nok, hvordan virkemidler eller komposition skaber betydning.",
    why_it_matters: "I dansk trækker det ned, hvis svaret bliver til referat i stedet for analyse af, hvordan teksten virker.",
    repair: "Løft svaret fra referat til analyse ved at vælge et virkemiddel eller et teksttræk og forklare, hvilken funktion det har.",
    example: "Skriv fx ikke kun hvad der sker, men vis hvordan fortæller, kontraster eller ordvalg skaber en bestemt virkning.",
  },
  dansk_fortolkning_for_loes: {
    category: "fortolkning",
    title: "Fortolkningen er for løs",
    diagnosis: "Du peger på en mulig fortolkning, men den bliver ikke forankret tydeligt nok i tekstens spor og sammenhæng.",
    why_it_matters: "En god danskfortolkning skal virke sandsynlig, fordi den bygger på tekstens mønstre, motiver og formuleringer.",
    repair: "Gør fortolkningen mere præcis og forankr den i flere konkrete tekstspor.",
    example: "Saml fx motiv, symbolik og ordvalg i en kort delkonklusion om tekstens overordnede tema.",
  },
  dansk_virkemiddel_uden_effekt: {
    category: "virkemidler",
    title: "Virkemidler nævnes uden effekt",
    diagnosis: "Du navngiver virkemidler eller sproglige træk, men du forklarer ikke tydeligt, hvad de gør i teksten.",
    why_it_matters: "I dansk tæller det ikke nok at pege på et virkemiddel; du skal også vise, hvilken stemning, betydning eller læservirkning det skaber.",
    repair: "Når du nævner et virkemiddel, så forklar også hvilken effekt det har på tekstens betydning eller læserens oplevelse.",
    example: "Skriv fx hvordan billedsprog, gentagelser eller kontraster understøtter temaet eller karakterfremstillingen.",
  },
  dansk_delkonklusion_mangler: {
    category: "struktur",
    title: "Delkonklusionen mangler",
    diagnosis: "Du har relevante observationer, men du samler dem ikke op i en tydelig delkonklusion.",
    why_it_matters: "En kort delkonklusion gør det lettere at se, hvad dine analyser faktisk viser, og hvordan de leder frem mod fortolkningen.",
    repair: "Afslut analysen eller afsnittet med 1-2 sætninger, der samler op på, hvad dine tekstobservationer viser.",
    example: "Skriv fx kort hvad dine iagttagelser samlet peger på i forhold til tema, relation eller fortæller.",
  },
  dansk_perspektivering_overfladisk: {
    category: "perspektivering",
    title: "Perspektiveringen er overfladisk",
    diagnosis: "Du nævner et muligt perspektiv, men forbindelsen til teksten bliver for løs eller for kort udfoldet.",
    why_it_matters: "Perspektivering i dansk virker bedst, når du viser en tydelig faglig forbindelse mellem teksten og det, du sammenligner med.",
    repair: "Gør perspektiveringen mere konkret ved at pege på én tydelig lighed eller forskel og forklare, hvorfor den er relevant.",
    example: "Sammenlign fx et tema, et motiv eller et fortællegreb og vis kort, hvad sammenligningen gør ved din læsning.",
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

export function inferDanskTrainerTask(question: string): DanskTrainerTaskType | null {
  const text = normalizeQuestionText(question);
  if (!DANSK_CONTEXT_RE.test(text)) return null;

  const scores: Record<DanskTrainerTaskType, number> = {
    dansk_fortolk_tekst: 0,
    dansk_analyser_virkemidler: 0,
    dansk_fortolk_og_dokumenter: 0,
  };

  if (/\bfortolk\b|\btema\b|\bmotiv\b|\bsymbolik\b/.test(text)) scores.dansk_fortolk_tekst += 4;
  if (/\banalyser\b|\banalyse\b/.test(text)) scores.dansk_analyser_virkemidler += 3;
  if (/\bvirkemiddel\b|\bvirkemidler\b|\bsprog\b|\bfortaeller\b|\bsynsvinkel\b|\bkomposition\b/.test(text)) {
    scores.dansk_analyser_virkemidler += 4;
  }
  if (/\bdokumenter\b|\bdokumenter med\b|\btekstbelaeg\b|\bcitat\b|\bcitater\b|\bunderbyg\b|\bunderstot\b/.test(text)) {
    scores.dansk_fortolk_og_dokumenter += 4;
  }
  if (/\btekstbelaeg\b|\btekststed\b|\btekststeder\b/.test(text)) scores.dansk_fortolk_og_dokumenter += 4;
  if (/\bperspektiver\b|\bperspektivering\b/.test(text)) scores.dansk_fortolk_og_dokumenter += 2;
  if (/\bfortolk\b/.test(text)) scores.dansk_fortolk_og_dokumenter += 2;

  const ranked = (Object.entries(scores) as Array<[DanskTrainerTaskType, number]>)
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score > 0);

  if (!ranked.length) return null;
  return ranked[0][0];
}

export function buildDanskTrainerPromptAddendum(taskType: DanskTrainerTaskType) {
  const taskSpecificGuidance =
    taskType === "dansk_fortolk_tekst"
      ? [
          "- Spørgsmålet kræver primært fortolkning: vurder om eleven går videre end løse påstande og forankrer fortolkningen i tekstens tema, motiv eller symbolik.",
          "- Hvis fortolkningen bliver for løs eller ikke samles op, så brug koden \"dansk_fortolkning_for_loes\" eller \"dansk_delkonklusion_mangler\".",
        ]
      : taskType === "dansk_analyser_virkemidler"
        ? [
            "- Spørgsmålet kræver analyse af virkemidler eller sprog.",
            "- Vurder om eleven forklarer virkemiddel + effekt, ikke kun nævner virkemidlet.",
            "- Hvis svaret bliver for refererende, så brug koden \"dansk_analyse_for_refererende\".",
          ]
        : [
            "- Spørgsmålet kræver både fortolkning og dokumentation.",
            "- Vurder om eleven bruger konkrete tekststeder som belæg og kobler dem til fortolkningen.",
            "- Hvis tekstbelægget er for svagt, så brug koden \"dansk_tekstbelaeg_for_svagt\".",
          ];

  return [
    "",
    "Danskfagligt vurderingsspor:",
    "- Skeln eksplicit mellem referat, analyse, fortolkning, dokumentation og perspektivering.",
    "- Vurder om eleven bruger konkrete tekststeder og viser, hvordan de understøtter pointen.",
    "- Vurder om virkemidler eller sproglige træk bliver forklaret med effekt og funktion, ikke kun nævnt.",
    "- Vurder om fortolkningen er forankret i teksten og ikke bare står som en løs påstand.",
    "- Vurder om eleven samler observationerne op i en kort delkonklusion, når det er relevant.",
    "- Brug helst disse issue-koder, når de passer:",
    "  - dansk_tekstbelaeg_for_svagt",
    "  - dansk_analyse_for_refererende",
    "  - dansk_fortolkning_for_loes",
    "  - dansk_virkemiddel_uden_effekt",
    "  - dansk_delkonklusion_mangler",
    "  - dansk_perspektivering_overfladisk",
    ...taskSpecificGuidance,
  ].join("\n");
}

export function getDanskIssueDefaults(code: string): DanskIssueDefault | null {
  return DANSK_ISSUE_DEFAULTS[code] ?? null;
}
