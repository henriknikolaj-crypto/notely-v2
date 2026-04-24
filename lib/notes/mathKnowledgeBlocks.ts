import { splitMathSentences, trimMathSentenceEnding } from "@/lib/notes/mathCandidatePieces";
import type { MathRecognizedConcept } from "@/lib/notes/mathConceptRecognizer";
import { classifyMathKnowledgeBlock, type MathKnowledgeBlockKind } from "@/lib/notes/mathBlockTyping";
import {
  isStableShortMathFormula,
  selectMathFormula,
  type MathFormulaCandidateTrace,
  type MathFormulaMode,
} from "@/lib/notes/mathFormulaSelector";

export type MathKnowledgeBlock = {
  id: string;
  title: string;
  kind: MathKnowledgeBlockKind;
  secondaryKinds: MathKnowledgeBlockKind[];
  topicGroup: string;
  shortExplanation: string;
  whatItMeans?: string;
  howToUse?: string;
  centralFormula?: string;
  notationExample?: string;
  formulaMode: MathFormulaMode;
  formulaConfidence: number;
  formulaDecision: string;
  formulaCandidates: MathFormulaCandidateTrace[];
  formulaRejectedCandidates: MathFormulaCandidateTrace[];
  shortExample?: string;
  teachingSteps?: string[];
  pitfalls?: string[];
  sourcePages: number[];
  sourceRefs: string[];
  confidence: number;
  conceptId: string;
  curriculumId: string;
  evidence: string[];
};

type MathConceptTeachingTemplate = {
  short: string;
  means: string;
  used: string;
  example?: string;
  pitfall?: string;
  steps?: string[];
};

const BAD_FALLBACK_PROSE_PATTERNS = [
  /derfor har vi ikke foretaget os noget forbudt/i,
  /\bforetaget os noget forbudt\b/i,
  /\bvi har ikke foretaget os\b/i,
];

const RAW_MARKDOWN_LEAK_RE =
  /(?:###|####|(?:^|\s)---(?:\s|$)|\*\*Formel:\*\*|##\s*(?:Vidensblokke|Nøgleformler)|_\s*(?:Metode|Regel|Begreb|Faldgrube|Eksempel))/i;

const CONCEPT_EXPLANATIONS: Record<string, MathConceptTeachingTemplate> = {
  "Standardform for andengradsligninger": {
    short: "Standardformen samler en andengradsligning som ax^2 + bx + c = 0",
    means: "koefficienterne a, b og c skal aflæses med fortegn, før metoder som diskriminant og løsningsformel kan bruges",
    used: "at gøre ligningen klar til løsning med diskriminantmetoden eller løsningsformlen",
    example: "I 3x^2 + 2x - 5 = 0 er a = 3, b = 2 og c = -5.",
  },
  "Koefficienterne a, b og c": {
    short: "Koefficienterne a, b og c er de tal, man aflæser i standardformen ax^2 + bx + c = 0",
    means: "fortegnene hører med til tallene, så b eller c kan være negative",
    used: "at indsætte de rigtige værdier i diskriminanten, løsningsformlen og toppunktsformlen",
    example: "I 2x^2 - 7x + 3 = 0 er a = 2, b = -7 og c = 3.",
  },
  "Diskriminantmetoden": {
    short: "Diskriminantmetoden starter med at beregne d og bruger derefter d til at vælge næste skridt",
    means: "diskriminanten afgør både antal løsninger og om løsningsformlen skal bruges",
    used: "at løse andengradsligninger systematisk",
    steps: [
      "Skriv ligningen på standardform.",
      "Beregn diskriminanten d.",
      "Aflæs løsningstilfældet og brug eventuelt løsningsformlen.",
    ],
  },
  "Nulreglen": {
    short: "Nulreglen siger, at et produkt er nul, når mindst én faktor er nul",
    means: "en faktoriseret ligning kan deles op i enklere ligninger",
    used: "at løse andengradsligninger, der kan faktoriseres",
  },
  "Monotonisætningen": {
    short: "Monotonisætningen forbinder fortegnet for den afledte med grafens udvikling på et interval",
    means: "fortegnet for den afledte funktion fortæller, om funktionen vokser, aftager eller er konstant på et interval",
    used: "at undersøge en funktions udvikling uden kun at aflæse grafen",
    example: "Hvis den afledte er positiv i et interval, læses funktionen som voksende i intervallet.",
    pitfall: "Tjek intervallerne mellem nulpunkterne for den afledte, ikke kun selve nulpunkterne.",
  },
  "Fortegn for den afledte": {
    short: "Fortegnet for den afledte viser, om funktionen vokser eller aftager på et interval",
    means: "positiv afledt betyder voksende funktion, mens negativ afledt betyder aftagende funktion",
    used: "at udfylde monotonilinjen og begrunde grafens udvikling",
    example: "Når f'(x) er positiv mellem to nulpunkter, er funktionen voksende i det interval.",
  },
  "Monotonilinje": {
    short: "En monotonilinje samler fortegnene for den afledte, så funktionens udvikling kan læses hurtigt",
    means: "man samler fortegn for den afledte i en oversigt, så grafens udvikling bliver lettere at læse",
    used: "at finde voksende og aftagende intervaller samt mulige ekstrema",
    example: "Efter nulpunkterne for den afledte er fundet, testes fortegnet i hvert interval.",
    steps: [
      "Find de x-værdier, hvor f'(x) = 0.",
      "Undersøg fortegnet for f' i hvert interval.",
      "Aflæs hvor funktionen vokser, aftager eller har ekstremum.",
    ],
  },
  "Monotoniforhold": {
    short: "Monotoniforhold beskriver, hvor en funktion er voksende eller aftagende",
    means: "grafens udvikling opdeles i intervaller, så man kan se funktionens retning",
    used: "at beskrive en funktions udvikling præcist med intervaller",
  },
  "Nulpunkter for den afledte": {
    short: "Nulpunkter for den afledte er steder, hvor grafen kan skifte retning",
    means: "f'(x) = 0 giver kandidater til lokale maksimums- eller minimumspunkter",
    used: "at finde de x-værdier, der skal undersøges i monotoni og optimering",
    steps: [
      "Differentier funktionen.",
      "Løs ligningen f'(x) = 0.",
      "Brug løsningerne videre i monotoni eller optimering.",
    ],
  },
  "Optimering": {
    short: "Optimering handler om at finde den bedste mulige værdi under bestemte betingelser",
    means: "man leder efter den største eller mindste mulige værdi under bestemte betingelser",
    used: "at omsætte et problem til en funktion og finde maksimum eller minimum",
    example: "Et problem kan handle om at minimere materialeforbrug eller maksimere en størrelse.",
  },
  "Optimering med volumenbetingelse": {
    short: "Ved optimering med volumenbetingelse bruges en fast volumen til at reducere antallet af variable",
    means: "en fast volumen bruges som betingelse, så problemet kan beskrives med færre variable",
    used: "at finde den dimension eller værdi, der giver et optimalt resultat",
    example: "Hvis volumen er fast, kan højden skrives ud fra sidelængden og sættes ind i arealfunktionen.",
    pitfall: "Husk at kontrollere, hvilke værdier der faktisk giver mening i problemet, fx positive længder.",
    steps: [
      "Omskriv volumenbetingelsen, så én variabel isoleres.",
      "Sæt udtrykket ind i den funktion, der skal optimeres.",
      "Differentier og undersøg kandidaterne i den gyldige definitionsmængde.",
    ],
  },
  "Volumenbetingelse": {
    short: "En volumenbetingelse binder variablerne sammen i et optimeringsproblem",
    means: "den faste volumen kan bruges til at skrive én variabel ved hjælp af en anden",
    used: "at reducere et optimeringsproblem til én variabel",
    example: "Hvis x^2h = 100, kan højden skrives som h = 100 / x^2.",
    steps: [
      "Skriv volumenkravet som en ligning mellem variablerne.",
      "Isolér den variabel, du vil indsætte senere.",
    ],
  },
  "Indsættelse af volumenbetingelsen": {
    short: "Når volumenbetingelsen er omskrevet, sættes den ind i den funktion, der skal optimeres",
    means: "problemet bliver lettere, fordi overfladearealet kan skrives som en funktion af én variabel",
    used: "at gøre optimeringsopgaven klar til differentiation",
    example: "Hvis h = 100 / x^2, kan højden erstattes i formlen for overfladearealet.",
    steps: [
      "Omskriv først volumenbetingelsen.",
      "Erstat den ene variabel i målfunktionen.",
      "Forenkle til en funktion af én variabel.",
    ],
  },
  "Definitionsmængde i optimering": {
    short: "Definitionsmængden i en optimeringsopgave bestemmes af, hvilke værdier der giver mening i situationen",
    means: "længder, arealer og volumener kan ofte kun være positive",
    used: "at undgå løsninger, der er matematiske, men ikke passer til den praktiske opgave",
    example: "For en kasselængde vil man typisk kræve x > 0.",
  },
  "Overfladeareal som funktion": {
    short: "Overfladearealet omskrives til en funktion, som kan optimeres",
    means: "den størrelse, der skal minimeres eller maksimeres, beskrives med en formel",
    used: "at gøre en praktisk optimeringsopgave klar til differentialregning",
    steps: [
      "Skriv overfladearealet som en funktion.",
      "Indsæt betingelserne, så kun én variabel er tilbage.",
      "Gør funktionen klar til differentiation.",
    ],
  },
  "Førsteordensbetingelse for optimering": {
    short: "Førsteordensbetingelsen bruger den afledte til at finde kandidater til optimum",
    means: "et indre maksimum eller minimum findes typisk blandt steder, hvor den afledte er nul",
    used: "at finde mulige minimums- eller maksimumspunkter efter funktionen er opstillet",
  },
  "Afstandsformlen mellem to punkter": {
    short: "Afstandsformlen beregner længden mellem to punkter i et koordinatsystem",
    means: "afstanden mellem to koordinatpunkter kan findes ved at se på forskellen i x- og y-retning",
    used: "at beregne længder i et koordinatsystem",
    example: "Punkterne A og B kan forbindes med en retvinklet trekant, hvor forskellene i koordinaterne er kateter.",
  },
  "Løsningsformlen for andengradsligninger": {
    short: "Løsningsformlen giver rødderne i en andengradsligning direkte fra koefficienterne",
    means: "rødderne i en andengradsligning kan bestemmes direkte ud fra koefficienterne",
    used: "at løse andengradsligninger, når de står på standardform",
    example: "Når a, b og c er identificeret, sættes de ind i formlen for at finde x-værdierne.",
    pitfall: "Brug formlen på en ligning, der først er skrevet på standardform.",
  },
  "Diskriminant og betydning": {
    short: "Diskriminanten fortæller først, hvor mange reelle løsninger en andengradsligning har",
    means: "diskriminanten afgør, hvor mange reelle løsninger en andengradsligning har",
    used: "at vurdere antallet af skæringer med x-aksen før man beregner løsningerne",
    example: "Hvis diskriminanten er positiv, har ligningen to reelle løsninger.",
  },
  "Diskriminantens løsningstilfælde": {
    short: "Diskriminantens fortegn afgør, om der er to, én eller ingen reelle løsninger",
    means: "d > 0 giver to løsninger, d = 0 giver én dobbeltrod, og d < 0 giver ingen reelle løsninger",
    used: "at vælge den rigtige konklusion, før man eventuelt regner rødderne ud",
  },
  "Kvadratkomplettering": {
    short: "Kvadratkomplettering omskriver et andengradspolynomium, så en del af udtrykket bliver et kvadrat",
    means: "man lægger et passende kvadrattal til, så udtrykket kan skrives som en parentes i anden",
    used: "at omskrive eller løse andengradsligninger uden først at bruge løsningsformlen",
    example: "Udtrykket x^2 + 6x kan ses som starten på (x + 3)^2, fordi halvdelen af 6 er 3.",
    pitfall: "Hvis der tilføjes et tal på den ene side af en ligning, skal ligningen stadig holdes i balance.",
    steps: [
      "Saml x-leddene, så koefficienten foran x^2 er enkel.",
      "Tilføj kvadrattallet, så parentesen bliver et kvadrat.",
      "Omskriv og løs videre derfra.",
    ],
  },
  "Cirklens ligning": {
    short: "Cirklens ligning beskriver alle punkter, der ligger i samme afstand fra centrum",
    means: "en cirkel beskrives ved et centrum og en radius i koordinatsystemet",
    used: "at afgøre om punkter ligger på cirklen og til at opstille cirkler analytisk",
    example: "Et punkt ligger på cirklen, når dets koordinater opfylder cirklens ligning.",
  },
  "Omskrivning af cirklens ligning": {
    short: "Omskrivning af cirklens ligning handler om at få ligningen på standardform, så centrum og radius kan aflæses",
    means: "man omskriver en cirkelligning, så de kvadrerede parenteser viser centrum og radius tydeligt",
    used: "at finde centrum og radius, når cirklens ligning ikke allerede står på standardform",
    example: "Kvadratkomplettering kan bruges til at samle x-led og y-led i hver sin parentes.",
  },
  "Distancen fra punkt til linje": {
    short: "Distancen fra punkt til linje beregner den korteste afstand fra et punkt til en ret linje",
    means: "afstanden måles vinkelret fra punktet ned på linjen",
    used: "at beregne afstande mellem punkter og linjer i analytisk geometri",
  },
  "Gaffelforskrift": {
    short: "En gaffelforskrift beskriver en funktion med forskellige forskrifter på forskellige intervaller",
    means: "en funktion kan være defineret med forskellige forskrifter på forskellige intervaller",
    used: "at beskrive stykkevise funktioner tydeligt",
    example: "Man vælger den forskrift, der passer til det interval, x-værdien ligger i.",
    pitfall: "Vær opmærksom på åbne og lukkede endepunkter, fordi de afgør hvilken forskrift der gælder.",
    steps: [
      "Find først det interval, x ligger i.",
      "Vælg den tilhørende forskrift.",
      "Beregn derefter som i en almindelig funktion.",
    ],
  },
  "Intervaller i stykkevise funktioner": {
    short: "Intervallerne fortæller, hvilken forskrift der gælder for en bestemt x-værdi",
    means: "før man beregner f(x), skal man afgøre, hvilket interval x ligger i",
    used: "at vælge den rigtige del af en gaffelforskrift",
    pitfall: "Endepunkter skal læses omhyggeligt, især når et interval er åbent og et andet er lukket.",
  },
  "Bollenotation for sammensatte funktioner": {
    short: "Bollenotation viser, hvilke endepunkter der hører med i de enkelte intervaller",
    means: "åbne og lukkede endepunkter fortæller, hvilken forskrift der gælder ved grænseværdier",
    used: "at afgøre hvilken del af en stykkevis funktion der skal bruges ved et bestemt x",
    pitfall: "To intervaller må ikke begge tage samme endepunkt, medmindre materialet definerer det sådan.",
  },
  "Tangentligningen": {
    short: "Tangentligningen beskriver den rette linje, der rører grafen i et bestemt punkt",
    means: "tangenten beskriver den rette linje, der rører grafen i et bestemt punkt",
    used: "at finde en lokal lineær beskrivelse af en funktion",
  },
  "Vendetangenter via f''(x)": {
    short: "Vendetangenter findes ved at kombinere vendepunktets placering med tangentligningen",
    means: "den anden afledte bruges til at finde mulige vendepunkter, og tangenten beskriver grafens lokale retning dér",
    used: "at opstille tangenten i et vendepunkt, når materialet arbejder med krumning og anden afledte",
  },
  "Toppunktsformlen": {
    short: "Toppunktsformlen finder parablens højeste eller laveste punkt",
    means: "toppunktet er parablens højeste eller laveste punkt afhængigt af grafens retning",
    used: "at finde ekstrempunktet for et andengradspolynomium",
  },
  "Differentialkvotient og afledt": {
    short: "Den afledte beskriver, hvor hurtigt funktionen ændrer sig i et punkt",
    means: "den afledte beskriver den øjeblikkelige ændring eller hældning på grafen",
    used: "at undersøge vækst, tangenter, monotoni og optimering",
    example: "Når den afledte sættes lig nul, finder man kandidater til vandrette tangenter.",
  },
  "Differentialkvotient som tangentens hældning": {
    short: "Differentialkvotienten i et punkt svarer til tangentens hældning i punktet",
    means: "den afledte forbinder grafens lokale retning med en talværdi",
    used: "at fortolke f'(x0) geometrisk og arbejde videre med tangenter",
  },
  "Tretrinsreglen": {
    short: "Tretrinsreglen er en metode til at bestemme differentialkvotienten fra definitionen",
    means: "man undersøger ændringskvotienten og lader til sidst tilvæksten gå mod nul",
    used: "at forstå, hvor regneregler for differentiation kommer fra",
    steps: [
      "Opstil ændringskvotienten.",
      "Forenkle udtrykket.",
      "Lad tilvæksten gå mod nul.",
    ],
  },
  "Lineære funktioner": {
    short: "Lineære funktioner ændrer sig med samme størrelse for hvert skridt i x",
    means: "en lineær funktion har konstant ændring og grafen er en ret linje",
    used: "at modellere sammenhænge med fast hældning og begyndelsesværdi",
  },
  "Proportionalitet": {
    short: "Proportionalitet betyder, at to størrelser følges ad med et fast forhold",
    means: "to størrelser følges ad efter et fast forhold",
    used: "at genkende og beregne simple sammenhænge mellem variable",
  },
  "Eksponentialfunktioner": {
    short: "Eksponentialfunktioner beskriver udvikling med en fast faktor",
    means: "ændringen sker med en fast faktor for hvert skridt i x",
    used: "at beskrive vækst, fald, fordobling og halvering",
  },
  "Definitionsmængde og værdimængde": {
    short: "Definitionsmængde og værdimængde afgrænser en funktions mulige input og output",
    means: "definitionsmængden er de x-værdier, man må bruge, og værdimængden er de y-værdier, funktionen kan give",
    used: "at afgrænse en funktion og læse dens mulige input og output",
  },
  "Trigonometriske relationer": {
    short: "Trigonometriske relationer kobler vinkler og sidelængder i trekanter",
    means: "sinus, cosinus og tangens kobler vinkler og sidelængder i trekanter",
    used: "at beregne ukendte vinkler eller sider",
    example: "Arealet af en trekant kan findes med to sider og den mellemliggende vinkel.",
  },
  "Sinus på enhedscirklen": {
    short: "Sinus på enhedscirklen aflæses som y-værdien til punktet på cirklen",
    means: "flere vinkler kan have samme sinusværdi, fordi de rammer samme højde på enhedscirklen",
    used: "at forstå trigonometriske værdier og flere mulige vinkler",
  },
  "Arealformlen for vilkårlige trekanter": {
    short: "Arealformlen beregner trekantens areal ud fra to sider og den mellemliggende vinkel",
    means: "sinus til vinklen bestemmer højden relativt til de kendte sider",
    used: "at finde areal, når trekanten ikke nødvendigvis er retvinklet",
  },
  "Pythagoræisk grundrelation": {
    short: "Den pythagoræiske grundrelation kobler sinus og cosinus for samme vinkel",
    means: "punktet på enhedscirklen opfylder en Pythagoras-sammenhæng",
    used: "at omskrive mellem trigonometriske udtryk",
  },
  "Cosinusrelationen": {
    short: "Cosinusrelationen bruges i trekanter, der ikke nødvendigvis er retvinklede",
    means: "cosinusrelationen udvider Pythagoras til trekanter, der ikke behøver være retvinklede",
    used: "at finde en ukendt side eller vinkel i en vilkårlig trekant",
  },
  "Sinusrelationen": {
    short: "Sinusrelationen kobler sider med deres modstående vinkler",
    means: "sinusrelationen kobler sider og modstående vinkler i en trekant",
    used: "at finde ukendte sider eller vinkler, når passende modstående par kendes",
  },
  "Stykkevise funktioner": {
    short: "Stykkevise funktioner skifter forskrift afhængigt af intervallet",
    means: "x-værdien afgør, hvilken del af funktionsforskriften der skal bruges",
    used: "at beskrive funktioner, der opfører sig forskelligt i forskellige områder",
  },
  "Differentiation af stykkevise funktioner": {
    short: "Stykkevise funktioner differentieres interval for interval",
    means: "hver forskrift behandles for sig på det interval, hvor den gælder",
    used: "at finde afledte for funktioner med flere forskrifter",
  },
};

function pickSentence(text: string, patterns: RegExp[]) {
  for (const sentence of splitMathSentences(text)) {
    const trimmed = trimMathSentenceEnding(sentence);
    if (trimmed.length < 24 || trimmed.length > 220) continue;
    if (patterns.some((pattern) => pattern.test(trimmed))) return trimmed;
  }
  return null;
}

function firstReadableSentence(text: string) {
  return (
    splitMathSentences(text)
      .map((sentence) => trimMathSentenceEnding(sentence))
      .find((sentence) => sentence.length >= 28 && sentence.length <= 220 && /[A-Za-zÆØÅæøå]/.test(sentence)) ?? null
  );
}

function isFormulaHeavySentence(text: string) {
  const symbols = (text.match(/[=≈≤≥<>^√±]/g) ?? []).length;
  return symbols >= 2 || text.length > 180;
}

function hasMathNotation(text: string) {
  return /(?:=|≈|≤|≥|<|>|\^|_|√|±|\\frac|\\sqrt|f['’]\(|\b(?:sin|cos|tan)\s*\()/i.test(text);
}

function findNotationSentence(sourceText: string, formula?: string) {
  const sentences = splitMathSentences(sourceText)
    .map((sentence) => trimMathSentenceEnding(sentence))
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 190 && hasMathNotation(sentence));

  if (formula) {
    const normalizedFormula = formula.replace(/\s+/g, " ").toLowerCase();
    const match = sentences.find((sentence) => sentence.replace(/\s+/g, " ").toLowerCase().includes(normalizedFormula));
    if (match) return match;
  }

  return sentences.find((sentence) => !/^\d+(?:\.\d+)+\s*$/.test(sentence));
}

function retainFormulaForBlock(args: {
  kind: MathKnowledgeBlockKind;
  centralFormula?: string;
  inlineFormula?: string;
  sourceText: string;
}) {
  const sourceFormula = args.centralFormula ?? args.inlineFormula;
  const notationSentence = findNotationSentence(args.sourceText, sourceFormula);
  const notationExample =
    args.inlineFormula ??
    (args.kind === "concept" || args.kind === "method" || args.kind === "example" ? args.centralFormula : undefined) ??
    (notationSentence && isStableShortMathFormula(notationSentence) ? notationSentence : undefined);

  return {
    centralFormula: args.centralFormula,
    notationExample,
    notationSentence,
  };
}

function templateShortExplanation(concept: MathRecognizedConcept, template?: MathConceptTeachingTemplate) {
  if (!template) return `${concept.title} er et centralt begreb i det udvalgte materiale.`;
  return `${template.short}.`;
}

function cleanTeachingText(text: string) {
  const cleaned = trimMathSentenceEnding(text)
    .replace(/\s+\d+(?:\.\d+)+\s+[A-ZÆØÅ][A-Za-zÆØÅæøå ]{3,48}$/u, "")
    .replace(/^\d+(?:\.\d+)+\s+/, "")
    .trim();
  if (BAD_FALLBACK_PROSE_PATTERNS.some((pattern) => pattern.test(cleaned))) return "";
  if (RAW_MARKDOWN_LEAK_RE.test(cleaned)) return "";
  return cleaned;
}

function extractExample(text: string) {
  const example = pickSentence(text, [/\b(?:eksempel|fx|f\.eks\.|hvis)\b/i, /\([^)]+,[^)]+\)/]);
  if (!example) return undefined;
  if (/^eksempel\s*\d*\s*(viser|handler|gennemgår)?\s*$/i.test(example)) return undefined;
  if (/^eksempel\s*\d*\s+(?:viser|handler|gennemgår)\s+[A-Za-zÆØÅæøå ]{3,80}$/i.test(example)) return undefined;
  return example.length <= 155 ? example : `${example.slice(0, 152).trim()}...`;
}

function extractPitfalls(text: string, templatePitfall?: string) {
  const pitfalls = [
    pickSentence(text, [/^(?:pas på|pas paa|bemærk|bemaerk|husk|vær opmærksom|vaer opmaerksom|undgå|undgaa)\b/i]),
    templatePitfall,
  ]
    .map((value) => (value ? cleanTeachingText(value) : ""))
    .filter((value): value is string => Boolean(value))
    .filter((value) => !BAD_FALLBACK_PROSE_PATTERNS.some((pattern) => pattern.test(value)));

  return Array.from(new Set(pitfalls.map((pitfall) => trimMathSentenceEnding(pitfall)))).slice(0, 2);
}

function sourceRefs(concept: MathRecognizedConcept) {
  return concept.sourceRefs.length ? concept.sourceRefs : ["Materialeuddrag"];
}

function teachingStepsForConcept(kind: MathKnowledgeBlockKind, template?: MathConceptTeachingTemplate) {
  if (kind !== "method" || !template?.steps?.length) return undefined;
  return template.steps.slice(0, 3).map((step) => cleanTeachingText(step)).filter(Boolean);
}

export function buildMathKnowledgeBlocksFromConcepts(concepts: MathRecognizedConcept[], limit = 28): MathKnowledgeBlock[] {
  return concepts.slice(0, limit).map((concept, index) => {
    const sourceText = concept.pieces.map((piece) => piece.text).join(" ");
    const template = CONCEPT_EXPLANATIONS[concept.title];
    const sourceSentence = firstReadableSentence(sourceText);
    const typing = classifyMathKnowledgeBlock(concept);
    const formula = selectMathFormula(concept);

    const sourceShortExplanation =
      pickSentence(sourceText, [/\b(?:er|handler om|bruges til|kaldes|viser|beskriver|betyder)\b/i]) ??
      sourceSentence;
    const shortExplanation =
      sourceShortExplanation && !template && !isFormulaHeavySentence(sourceShortExplanation)
        ? sourceShortExplanation
        : templateShortExplanation(concept, template);

    const whatItMeans =
      pickSentence(sourceText, [/\b(?:det betyder|det vil sige|altså|svarer til)\b/i]) ??
      (template ? `Det betyder, at ${template.means}.` : `Det betyder, at materialet behandler ${concept.title.toLowerCase()} som et fagligt nøglepunkt.`);

    const howToUse =
      template
        ? `Det bruges til ${template.used}.`
        : pickSentence(sourceText, [/\b(?:bruges til|kan bruges til|bestemme|beregne|undersøge|undersoege|finde|løse|loese)\b/i]) ??
          `Det bruges til at arbejde videre med ${concept.title.toLowerCase()} i materialets opgaver og forklaringer.`;

    const pitfalls = extractPitfalls(sourceText, template?.pitfall);
    const sourceExample = extractExample(sourceText);
    const retainedFormula = retainFormulaForBlock({
      kind: typing.kind,
      centralFormula: formula.centralFormula,
      inlineFormula: formula.inlineFormula,
      sourceText,
    });
    const shortExample =
      sourceExample && sourceExample !== shortExplanation
        ? sourceExample
        : retainedFormula.notationSentence && typing.kind === "example"
          ? retainedFormula.notationSentence
          : template?.example;
    const teachingSteps = teachingStepsForConcept(typing.kind, template);

    return {
      id: `math-block-${index + 1}`,
      title: concept.title,
      kind: typing.kind,
      secondaryKinds: typing.secondaryHints,
      topicGroup: concept.topicGroup,
      shortExplanation: cleanTeachingText(shortExplanation),
      whatItMeans: cleanTeachingText(whatItMeans),
      howToUse: cleanTeachingText(howToUse),
      centralFormula: retainedFormula.centralFormula,
      notationExample: retainedFormula.notationExample,
      formulaMode: formula.mode,
      formulaConfidence: formula.confidence,
      formulaDecision: formula.reason,
      formulaCandidates: formula.candidates,
      formulaRejectedCandidates: formula.rejectedCandidates,
      shortExample: shortExample ? cleanTeachingText(shortExample) : undefined,
      teachingSteps: teachingSteps?.length ? teachingSteps : undefined,
      pitfalls: pitfalls.length ? pitfalls : undefined,
      sourcePages: concept.sourcePages,
      sourceRefs: sourceRefs(concept),
      confidence: Number(concept.confidence.toFixed(2)),
      conceptId: concept.id,
      curriculumId: concept.curriculumId,
      evidence: concept.pieces.slice(0, 4).map((piece) => piece.text),
    };
  });
}

export function buildMathKnowledgeBlocksText(blocks: MathKnowledgeBlock[]) {
  return blocks
    .map((block, index) =>
      [
        `VIDENSBLOK ${index + 1}: ${block.title}`,
        `id: ${block.id}`,
        `kind: ${block.kind}`,
        `secondaryKinds: ${block.secondaryKinds.join(", ") || "ingen"}`,
        `topicGroup: ${block.topicGroup}`,
        `shortExplanation: ${block.shortExplanation}`,
        `whatItMeans: ${block.whatItMeans ?? "ikke udskilt"}`,
        `howToUse: ${block.howToUse ?? "ikke udskilt"}`,
        `formulaMode: ${block.formulaMode}`,
        `formulaConfidence: ${block.formulaConfidence.toFixed(2)}`,
        `centralFormula: ${block.centralFormula ?? "ingen centralformel"}`,
        `notationExample: ${block.notationExample ?? "ingen notation"}`,
        `formulaDecision: ${block.formulaDecision}`,
        `formulaCandidates: ${
          block.formulaCandidates.length
            ? block.formulaCandidates
                .map(
                  (item) =>
                    `${item.formula} [${item.decision}, confidence=${item.confidence.toFixed(2)}, semantic=${item.semanticScore}, corruption=${item.corruptionScore}, ${item.reason}]`,
                )
                .join(" | ")
            : "ingen kandidater"
        }`,
        `formulaRejected: ${
          block.formulaRejectedCandidates.length
            ? block.formulaRejectedCandidates
                .map((item) => `${item.formula} [semantic=${item.semanticScore}, corruption=${item.corruptionScore}, ${item.reason}]`)
                .join(" | ")
            : "ingen afviste"
        }`,
        `shortExample: ${block.shortExample ?? "intet kort eksempel udskilt"}`,
        `teachingSteps: ${block.teachingSteps?.join(" | ") ?? "ingen sikre mini-trin udskilt"}`,
        `pitfalls: ${block.pitfalls?.join(" | ") ?? "ingen sikre faldgruber udskilt"}`,
        `sourcePages: ${block.sourcePages.join(", ") || "ukendt"}`,
        `sourceRefs: ${block.sourceRefs.join(", ")}`,
        `confidence: ${block.confidence}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

export function buildMathPipelineDebugText(args: {
  candidatePieces: Array<{ id: string; kind?: string; text: string; sourceRef?: string }>;
  filteredPieces: Array<{ id: string; kind?: string; text: string; sourceRef?: string }>;
  rejectedPieces?: Array<{ id: string; kind?: string; text: string; sourceRef?: string; rejectionReason?: string }>;
  broadConcepts?: Array<{ id: string; title: string; topicGroup?: string; sourceRefs?: string[]; confidence?: number }>;
  splitConcepts?: Array<{ id: string; title: string; topicGroup?: string; sourceRefs?: string[]; confidence?: number }>;
  splitDebug?: string[];
  droppedSplitCandidates?: string[];
  normalizedConcepts: Array<{ id: string; title: string; sourceRefs?: string[]; confidence?: number }>;
  knowledgeBlocks: MathKnowledgeBlock[];
}) {
  const sample = <T>(items: T[]) => items.slice(0, 8);

  return [
    "LAG 1 - candidate pieces",
    ...sample(args.candidatePieces).map((piece) => `- ${piece.id} [${piece.kind ?? "piece"}] ${piece.sourceRef ?? ""}: ${piece.text}`),
    "",
    "LAG 2 - filtered pieces",
    ...sample(args.filteredPieces).map((piece) => `- ${piece.id} [${piece.kind ?? "piece"}] ${piece.sourceRef ?? ""}: ${piece.text}`),
    "",
    "LAG 2b - rejected noise",
    ...sample(args.rejectedPieces ?? []).map(
      (piece) => `- ${piece.id} [${piece.rejectionReason ?? "rejected"}] ${piece.sourceRef ?? ""}: ${piece.text}`,
    ),
    "",
    "LAG 3a - broad concepts before split",
    ...sample(args.broadConcepts ?? []).map(
      (concept) =>
        `- ${concept.id}: ${concept.title} (${concept.topicGroup ?? "ukendt gruppe"}, ${concept.sourceRefs?.join(", ") || "ukendt kilde"}, confidence=${concept.confidence?.toFixed(2) ?? "n/a"})`,
    ),
    "",
    "LAG 3b - split candidates",
    ...sample(args.splitConcepts ?? []).map(
      (concept) =>
        `- ${concept.id}: ${concept.title} (${concept.topicGroup ?? "ukendt gruppe"}, ${concept.sourceRefs?.join(", ") || "ukendt kilde"}, confidence=${concept.confidence?.toFixed(2) ?? "n/a"})`,
    ),
    "",
    "LAG 3b.1 - split drivers",
    ...sample(args.splitDebug ?? []).map((line) => `- ${line}`),
    "",
    "LAG 3b.2 - dropped/merged split candidates",
    ...sample(args.droppedSplitCandidates ?? []).map((line) => `- ${line}`),
    "",
    "LAG 3c - final merged concepts",
    ...sample(args.normalizedConcepts).map(
      (concept) =>
        `- ${concept.id}: ${concept.title} (${concept.sourceRefs?.join(", ") || "ukendt kilde"}, confidence=${concept.confidence?.toFixed(2) ?? "n/a"})`,
    ),
    "",
    "LAG 4-6 - typed knowledge blocks",
    ...sample(args.knowledgeBlocks).map(
      (block) =>
        `- ${block.id}: ${block.title} | kind=${block.kind} | formula=${block.formulaMode} | confidence=${block.formulaConfidence.toFixed(2)} | winner=${block.centralFormula ?? block.notationExample ?? "omitted"} | steps=${block.teachingSteps?.length ? block.teachingSteps.join(" / ") : "none"} | ${block.formulaDecision} | kilde=${block.sourceRefs.join(", ")}`,
    ),
  ].join("\n");
}
