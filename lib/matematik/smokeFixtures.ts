export type MathSmokeRenderKind = "inline" | "block" | "aligned" | "cases" | "invalid-soft-fail";

export type MathSmokeSurface =
  | "notes"
  | "trainer-feedback"
  | "exam"
  | "mc-explanation"
  | "flashcards-front"
  | "flashcards-back";

export type MathSmokeFixture = {
  id: string;
  title: string;
  summary: string;
  renderKinds: MathSmokeRenderKind[];
  surfaces: MathSmokeSurface[];
  content: string;
};

const ALL_SURFACES: MathSmokeSurface[] = [
  "notes",
  "trainer-feedback",
  "exam",
  "mc-explanation",
  "flashcards-front",
  "flashcards-back",
];

export const MATH_SMOKE_FIXTURES: MathSmokeFixture[] = [
  {
    id: "fraction-inline",
    title: "Brok",
    summary: "Inline-brok i almindelig tekst.",
    renderKinds: ["inline"],
    surfaces: ALL_SURFACES,
    content: "En kort brok som inline math: $\\frac{a}{b}$ og $\\frac{3}{4}$.",
  },
  {
    id: "root-power-index-inline",
    title: "Rod, potens og indeks",
    summary: "Kombinerer rod, potens og indeks i en kort saetning.",
    renderKinds: ["inline"],
    surfaces: ALL_SURFACES,
    content: "Udtryk med rod, potens og indeks: $\\sqrt{x^2 + 1}$, $2^5$ og $a_n$.",
  },
  {
    id: "greek-vector-inline",
    title: "Graeske bogstaver og vektor",
    summary: "Tester inline notation for bogstaver og vektorer.",
    renderKinds: ["inline"],
    surfaces: ALL_SURFACES,
    content: "Graeske bogstaver og vektor: $\\alpha + \\beta = \\gamma$ og $\\vec{v} = (2,-1)$.",
  },
  {
    id: "derivative-block",
    title: "Derivat",
    summary: "En enkel derivatblok med afledt funktion.",
    renderKinds: ["block"],
    surfaces: ALL_SURFACES,
    content: "$$\nf(x)=x^3-2x\n$$\n\n$$\nf'(x)=3x^2-2\n$$",
  },
  {
    id: "integral-block",
    title: "Integral",
    summary: "Definit integral med brok i resultatet.",
    renderKinds: ["block"],
    surfaces: ALL_SURFACES,
    content: "$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$",
  },
  {
    id: "quadratic-aligned",
    title: "Andengradsligning step-by-step",
    summary: "Laerebogsagtig omskrivning med aligned.",
    renderKinds: ["block", "aligned"],
    surfaces: ["notes", "trainer-feedback", "exam", "flashcards-back"],
    content:
      "$$\n\\begin{aligned}\n2x^2 + 12x - 32 &= 0 \\\\\n2x^2 + 12x &= 32 \\\\\nx^2 + 6x &= 16 \\\\\nx^2 + 6x + 3^2 &= 16 + 3^2 \\\\\n(x + 3)^2 &= 25\n\\end{aligned}\n$$\n\n$$\nx = -3 \\pm 5\n$$",
  },
  {
    id: "cases-solution-set",
    title: "Cases og loesningsmaengde",
    summary: "Flere loesninger skrevet med cases.",
    renderKinds: ["block", "cases"],
    surfaces: ["notes", "trainer-feedback", "exam", "flashcards-back"],
    content: "$$\nx \\in \\begin{cases}\n2 \\\\\n-8\n\\end{cases}\n$$",
  },
  {
    id: "markdown-mixed-normalization",
    title: "Markdown blandet med math-normalisering",
    summary: "Lister med baade $...$, \\(...\\) og \\[...\\].",
    renderKinds: ["inline", "block"],
    surfaces: ALL_SURFACES,
    content:
      "- Punkt 1: $x^2$\n- Punkt 2: \\(f'(x)\\)\n\n\\[\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n\\]",
  },
  {
    id: "double-escaped-model-output",
    title: "Dobbelte escapes fra model-output",
    summary: "Stand-alone mathtekst som ligner LLM-output med dobbelte escapes.",
    renderKinds: ["inline"],
    surfaces: ["notes", "trainer-feedback", "exam", "mc-explanation", "flashcards-back"],
    content: "\\\\frac{a}{b}, \\\\alpha, \\\\vec{v}",
  },
  {
    id: "short-mathish-auto-normalization",
    title: "Kort math-ish auto-normalisering",
    summary: "UI-naere eksempler som ikke starter som ren LaTeX, men boer forbedres foer rendering.",
    renderKinds: ["inline"],
    surfaces: ALL_SURFACES,
    content:
      "- x - 3 = ±√1\n- x = (-b +/- sqrt(d)) / 2a\n- f'(x)=3x^2\n- a_n = alpha + beta\n- v = [1,2]\n- integral fra 0 til 1 af x^2 dx",
  },
  {
    id: "short-mathish-anti-false-positive",
    title: "Anti false positives",
    summary: "Korte tekstcases som ikke boer auto-normaliseres til math.",
    renderKinds: ["inline"],
    surfaces: ALL_SURFACES,
    content:
      "- Version 3.14 er live\n- Kapitel 1,2 og 1,3\n- alpha test er startet\n- beta-versionen er klar\n- sqrt bruges i et kodeeksempel\n- A = B kan vaere placeholder i almindelig tekst\n- I datafeltet bruges v = [1,2] som eksempel\n- Brug +/- i almindelig prose hvis konteksten ikke er matematik\n- pipeline er startet\n- Filnavnet x_y_backup.json er gemt",
  },
  {
    id: "invalid-math-soft-fail",
    title: "Ugyldig math",
    summary: "Renderer maa gerne blive grim, men siden maa ikke crashe.",
    renderKinds: ["invalid-soft-fail"],
    surfaces: ALL_SURFACES,
    content: "Ugyldig math maa ikke crashe: $\\fra{1}{2}$ og $$\\begin{aligned}x &= \\sqrt{\\end{aligned}$$",
  },
];

export const MATH_SMOKE_SURFACE_PREVIEWS = {
  trainerFeedback: {
    title: "Traener-feedback",
    content:
      "Metoden er naesten rigtig, men vis mellemregningen tydeligere:\n\n$$\n\\begin{aligned}\nx^2 + 6x &= 16 \\\\\n(x + 3)^2 &= 25\n\\end{aligned}\n$$\n\nSkriv derefter slutresultatet separat som $$x = -3 \\pm 5$$ og afslut med loesningsmaengden $$x \\in \\begin{cases}2 \\\\ -8\\end{cases}$$.",
  },
  exam: {
    title: "Eksamen",
    content:
      "Et kort eksamenssvar kan skrive mellemregningen i blok og resultatet separat:\n\n$$\n\\begin{aligned}\n\\int_0^1 x^2 \\, dx &= \\left[\\frac{x^3}{3}\\right]_0^1\n\\end{aligned}\n$$\n\n$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$",
  },
  mcExplanation: {
    title: "MC explanation",
    content: "Rigtigt svar, fordi $f'(x)=3x^2-2$ og derfor er $f'(2)=10$.",
  },
  flashcardsFront: {
    title: "Flashcards front",
    content: "Hvad er stamfunktionen til $2x$?",
  },
  flashcardsBack: {
    title: "Flashcards back",
    content:
      "En stamfunktion er $F(x)=x^2 + C$.\n\n$$\n\\begin{aligned}\n\\frac{d}{dx}(x^2 + C) &= 2x\n\\end{aligned}\n$$",
  },
} as const;
