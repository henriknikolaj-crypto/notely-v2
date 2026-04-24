import { buildMatematikOutputStylePromptBlock } from "@/lib/matematik/outputStyle";

export type MatematikTrainerTaskType =
  | "matematik_beregn_og_vis_metode"
  | "matematik_fortolk_graf_eller_funktion"
  | "matematik_begrund_eller_bevis";

type MatematikIssueDefault = {
  category: string;
  title: string;
  diagnosis: string;
  why_it_matters: string;
  repair: string;
  example?: string;
};

const MATEMATIK_CONTEXT_RE =
  /\b(matematik|beregn|bestem|loes|løs|udled|begrund|bevis|graf|funktion|haeldning|hældning|skaering|skæring|sandsynlighed|enhed|enheder|model|ligning|parabel|vektor|procent|deriver|integral)\b/i;

const MATEMATIK_ISSUE_DEFAULTS: Record<string, MatematikIssueDefault> = {
  matematik_metode_ikke_tydelig: {
    category: "metode",
    title: "Metoden er ikke tydelig nok",
    diagnosis: "Du kommer frem til et svar, men det er ikke tydeligt nok, hvilken metode eller regel du bruger undervejs.",
    why_it_matters: "I matematik tæller fremgangsmåden, fordi den viser, at du kan løse opgaven systematisk og ikke kun ramme et muligt slutresultat.",
    repair: "Vis tydeligere hvilken metode du bruger, og marker de vigtigste trin mellem start og slutresultat.",
    example: "Skriv fx hvilket regnetrin, formelvalg eller omformning der fører dig fra første udtryk til næste.",
  },
  matematik_mellemregninger_mangler: {
    category: "mellemregninger",
    title: "Mellemregningerne mangler",
    diagnosis: "Du springer for hurtigt fra opgavens udgangspunkt til resultatet, så man ikke kan følge beregningen sikkert.",
    why_it_matters: "Når mellemregninger mangler, bliver det svært at se både metode, regnefejl og hvorfor konklusionen bør være korrekt.",
    repair: "Vis mellemregningerne i de trin, hvor du omformer, indsætter tal eller regner videre mod resultatet.",
    example: "Skriv fx mellemregningen mellem ligning A og B, så hvert trin kan følges.",
  },
  matematik_regnefejl_trods_rigtig_metode: {
    category: "regnefejl",
    title: "Der er en regnefejl, selv om metoden er rigtig",
    diagnosis: "Du vælger en relevant metode, men der opstår en fejl i et af de sidste regnetrin.",
    why_it_matters: "Det er vigtigt at kunne skelne mellem metodefejl og regnefejl, så du kan bygge videre på den rigtige tilgang i næste forsøg.",
    repair: "Behold metoden, men kontroller de sidste regnetrin systematisk, især tegn, indsættelser og afrunding.",
    example: "Gennemgå fx sidste trin linje for linje og tjek om tal, parenteser og fortegn er ført korrekt videre.",
  },
  matematik_resultat_ikke_tolket: {
    category: "fortolkning",
    title: "Resultatet bliver ikke tolket tydeligt nok",
    diagnosis: "Du finder et matematisk resultat, men forklarer ikke tydeligt, hvad det betyder i opgavens sammenhæng.",
    why_it_matters: "I matematikopgaver med funktioner, modeller, grafer eller sandsynlighed skal resultatet ofte fortolkes og knyttes til situationen.",
    repair: "Skriv kort hvad resultatet betyder i denne sammenhæng, og knyt det til grafen, modellen eller størrelsen i opgaven.",
    example: "Forklar fx hvad hældningen, skæringen eller sandsynligheden betyder i netop denne model.",
  },
  matematik_enheder_eller_notering_usikker: {
    category: "notation",
    title: "Enheder eller notation er usikre",
    diagnosis: "Der mangler enhed, eller notationen er upræcis, så resultatet bliver sværere at læse fagligt korrekt.",
    why_it_matters: "Korrekt notation og enheder er en del af den matematiske præcision og er ofte nødvendige for at forstå resultatet rigtigt.",
    repair: "Skriv enhed på slutresultatet og brug matematisk notation mere konsekvent gennem løsningen.",
    example: "Skriv fx om svaret er i cm, %, kr. eller en anden relevant enhed, og marker variabler tydeligt.",
  },
  matematik_begrundelse_for_tynd: {
    category: "begrundelse",
    title: "Begrundelsen er for tynd",
    diagnosis: "Du giver et svar eller et udsagn, men forklarer ikke tydeligt hvorfor det følger af regler, definitioner eller beregninger.",
    why_it_matters: "Når opgaven beder om at begrunde eller bevise noget, skal svaret vise hvorfor konklusionen gælder, ikke kun hvad den er.",
    repair: "Forklar tydeligere hvorfor hvert centralt trin er gyldigt, og bind begrundelsen sammen med den matematiske regel eller idé du bruger.",
    example: "Skriv fx hvilken regel, definition eller egenskab der retfærdiggør overgangen mellem to trin.",
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

export function inferMatematikTrainerTask(question: string): MatematikTrainerTaskType | null {
  const text = normalizeQuestionText(question);
  if (!MATEMATIK_CONTEXT_RE.test(text)) return null;

  const scores: Record<MatematikTrainerTaskType, number> = {
    matematik_beregn_og_vis_metode: 0,
    matematik_fortolk_graf_eller_funktion: 0,
    matematik_begrund_eller_bevis: 0,
  };

  if (/\bberegn\b|\bbestem\b|\bloes\b|\bvis\b|\budled\b|\bsandsynlighed\b|\benhed\b|\bmodel\b/.test(text)) {
    scores.matematik_beregn_og_vis_metode += 4;
  }
  if (/\bgraf\b|\bfunktion\b|\bhaeldning\b|\bskaering\b|\bmodel\b/.test(text)) {
    scores.matematik_fortolk_graf_eller_funktion += 4;
  }
  if (/\bforklar\b/.test(text)) scores.matematik_fortolk_graf_eller_funktion += 2;
  if (/\bbegrund\b|\bbevis\b|\budled\b|\bforklar hvorfor\b/.test(text)) {
    scores.matematik_begrund_eller_bevis += 4;
  }
  if (/\bvis at\b/.test(text)) scores.matematik_begrund_eller_bevis += 3;

  const ranked = (Object.entries(scores) as Array<[MatematikTrainerTaskType, number]>)
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score > 0);

  if (!ranked.length) return null;
  return ranked[0][0];
}

export function buildMatematikTrainerPromptAddendum(taskType: MatematikTrainerTaskType) {
  const taskSpecificGuidance =
    taskType === "matematik_beregn_og_vis_metode"
      ? [
          "- Spørgsmålet kræver beregning og metodevisning.",
          "- Skeln tydeligt mellem korrekt resultat og korrekt metode: en elev kan have valgt rigtig metode men stadig have en regnefejl.",
          "- Hvis mellemregninger mangler, så brug koden \"matematik_mellemregninger_mangler\".",
        ]
      : taskType === "matematik_fortolk_graf_eller_funktion"
        ? [
            "- Spørgsmålet kræver fortolkning af graf, funktion eller model.",
            "- Vurder om eleven går videre end ren aflæsning og forklarer hvad hældning, skæring eller resultat betyder i sammenhængen.",
            "- Hvis resultatet ikke tolkes, så brug koden \"matematik_resultat_ikke_tolket\".",
          ]
        : [
            "- Spørgsmålet kræver begrundelse eller bevis.",
            "- Vurder om eleven faktisk forklarer hvorfor udsagnet gælder, og ikke kun skriver konklusionen.",
            "- Hvis begrundelsen er for tynd, så brug koden \"matematik_begrundelse_for_tynd\".",
          ];

  return [
    "",
    "Matematikfagligt vurderingsspor:",
    "- Vær konkret og teknisk i feedbacken. Matematik-feedback må gerne være kortere end i tekstfag.",
    "- Skeln mellem korrekt resultat, korrekt metode og regnefejl.",
    "- Vurder om eleven viser trin og mellemregninger tydeligt nok.",
    "- Vurder om enheder og notation er korrekte og konsistente.",
    "- Vurder om konklusionen faktisk matcher beregningen eller fortolkningen.",
    "- Brug helst disse issue-koder, når de passer:",
    "  - matematik_metode_ikke_tydelig",
    "  - matematik_mellemregninger_mangler",
    "  - matematik_regnefejl_trods_rigtig_metode",
    "  - matematik_resultat_ikke_tolket",
    "  - matematik_enheder_eller_notering_usikker",
    "  - matematik_begrundelse_for_tynd",
    "- Eksempler på god tone:",
    '  - "Vis mellemregningen mellem ligning A og B."',
    '  - "Skriv enhed på slutresultatet."',
    '  - "Forklar hvad hældningen betyder i denne sammenhæng."',
    '  - "Du har valgt rigtig metode, men der er en regnefejl i sidste trin."',
    ...taskSpecificGuidance,
    buildMatematikOutputStylePromptBlock("full"),
  ].join("\n");
}

export function getMatematikIssueDefaults(code: string): MatematikIssueDefault | null {
  return MATEMATIK_ISSUE_DEFAULTS[code] ?? null;
}
