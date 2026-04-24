type MatematikOutputStyleMode = "full" | "compact" | "card" | "notes";

const MATEMATIK_OUTPUT_CONTEXT_RE =
  /\b(matematik|math|maths|mathematics|mat|beregn|bestem|loes|løs|udled|begrund|bevis|graf|funktion|hældning|haeldning|skæring|skaering|sandsynlighed|enhed|enheder|model|ligning|parabel|vektor|procent|deriver|integral|brøk|brok|rod|kvadrat|indeks)\b/i;

export function looksLikeMatematikContent(value: string) {
  return MATEMATIK_OUTPUT_CONTEXT_RE.test(value.normalize("NFKC"));
}

export function buildMatematikOutputStylePromptBlock(mode: MatematikOutputStyleMode = "full") {
  const baseLines = [
    "",
    "Matematik-output-stil:",
    "- Når du skriver matematik, så brug KaTeX-venlig LaTeX.",
    "- Brug inline math med $...$ til korte symboler, variable og korte udtryk.",
    "- Brug block math med $$...$$ til egentlige mellemregninger, omskrivninger og længere formler.",
    "- Ved flere omskrivningstrin skal du foretrække $$\\begin{aligned}...\\end{aligned}$$.",
    "- Brug aligned, ikke align.",
    "- Hold forklarende tekst kort, og læg selve mellemregningerne inde i math-blokken med ét tydeligt trin per linje.",
    "- Når du løser en opgave trin for trin, så brug som standard denne struktur: først én aligned-blok med omskrivninger, derefter en separat afsluttende blok med resultatet.",
    "- Lad ikke slutsvaret drukne i samme aligned-blok som mellemregningerne, hvis der er en naturlig afsluttende svarlinje eller løsningsmængde.",
    "- Ved flere løsninger eller løsningsmængder skal du bruge cases eller en anden KaTeX-stabil struktur med samme tydelighed.",
    "- Hvis du har et mellemtrin med plus/minus, så skriv det med \\pm og afslut derefter med en separat blok for de konkrete løsninger.",
    "- Skriv \\sqrt{x} i stedet for sqrt(x), \\pm i stedet for +/-, og brug ikke -> eller = ... => ... når rigtig LaTeX er oplagt.",
    "- Undgå rå tekst som x=... i løbende tekst, hvis en math-blok er mere naturlig.",
    "- Brug ikke grafer, figurer eller ASCII-opstillinger.",
  ];

  const modeLines =
    mode === "card"
      ? [
          "- Kortformat: Foretræk 1-2 korte inline-formler frem for store blokke.",
          "- Front skal næsten altid bruge almindelig tekst og evt. én kort inline-formel; undgå block math på front.",
          "- Back eller explanation må højst bruge én lille, gyldig math-blok, hvis det tydeligt hjælper forståelsen.",
          "- Undgå lange aligned-blokke på flashcards. Hvis flere regnetrin bliver for brede eller lange, så komprimer til kort tekst plus én lille slutformel.",
          "- Skriv aldrig halvfærdige eller ubalancerede $$...$$-blokke, og skriv aldrig rå \\begin{aligned}...\\end{aligned} uden gyldig math-indpakning.",
          "- Hvis du er i tvivl, så vælg inline math frem for block math.",
          "- Kort eksempel til kortformat: `Diskriminanten er $d=b^2-4ac$. Derfor fås $x=\\frac{-b \\pm \\sqrt{d}}{2a}$.`",
        ]
      : mode === "notes"
        ? [
            "- Noter må gerne være mere lærebogsagtige, men de skal stadig læses som korte noter og ikke som tunge løsningsbeviser.",
            "- Når indholdet tydeligt er matematik, skal enkle formler og korte mellemregninger oftere skrives som rigtig, render-venlig LaTeX.",
            "- Brug korte math-blokke eller inline math dér, hvor det gør noterne lettere at læse, men hold blokkene kompakte.",
            "- Ved korte omskrivninger må du gerne bruge en lille aligned-blok, men undgå unødigt lange udledninger.",
            "- Foretræk pæne matematiske skrivemåder som \\sqrt{x}, \\frac{a}{b}, a_n, \\vec{v}, f'(x) og \\pm frem for pseudo-math i brødtekst.",
          ]
        : mode === "compact"
          ? [
              "- Hvis pladsen er kort, så hold teksten meget kort, men brug stadig aligned ved flere regnetrin og en separat slutblok, når der er flere løsninger.",
              "- Kort eksempel på trin + slutblok: $$\\begin{aligned}x^2 + 6x &= 16 \\\\ (x + 3)^2 &= 25\\end{aligned}$$ efterfulgt af $$x = -3 \\pm 5$$.",
            ]
          : [
              "- Ved step-by-step løsninger: vis tydelig progression linje for linje i én samlet aligned-blok.",
              "- Foretræk en separat slutblok efter aligned-blokken, fx først $$\\begin{aligned}2x^2 + 12x - 32 &= 0 \\\\ x^2 + 6x &= 16 \\\\ (x + 3)^2 &= 25\\end{aligned}$$ og derefter $$x = -3 \\pm 5$$.",
              "- Hvis slutsvaret er flere konkrete løsninger, så afslut med en separat løsningsmængde, fx $$x \\in \\begin{cases}2 \\\\ -8\\end{cases}$$.",
            ];

  return [...baseLines, ...modeLines].join("\n");
}
