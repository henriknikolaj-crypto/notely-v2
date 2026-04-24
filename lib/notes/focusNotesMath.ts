import type { FocusNotePlan } from "@/lib/notes/focusNotes";
import { buildMathFocusNoteArtifactsFromBlocks, buildMathFocusNoteFromBlocks } from "@/lib/notes/mathFocusNoteAssembly";

function buildStableMathFocusNoteGuidelines() {
  return [
    "Math-regel for matematik-Fokusnoter:",
    "- Skriv som en hybrid læringsside: kort intro, emneoversigt, nøgleformler og derefter selvstændige vidensblokke.",
    "- Introen skal være 2-4 korte sætninger og forklare materialets hovedretning uden AI-meta-sprog.",
    "- Introen må ikke sige 'rolig læserækkefølge', 'sikker notation' eller forklare systemets valg.",
    "- Emneoversigten skal være kort og beskrive, hvad hvert hovedområde bruges til, ikke bare gentage bloktitler.",
    "- Nøgleformler skal være få, sikre og centrale formler fra materialet.",
    "- Hver vidensblok skal kunne stå alene med titel, kort forklaring, eventuel formel/notation, kort brug eller eksempel og diskret kilde.",
    "- Brug som standard korte inline-formler med $...$ i bloktekst og korte display-formler kun i nøgleformelbokse eller til sikre centralformler.",
    "- En display-formel skal være én kort, standalone formel uden flere omskrivningstrin.",
    "- Brug ikke \\begin{aligned}, \\end{aligned}, cases, array, matrix eller andre multiline-miljøer.",
    "- Brug ikke lange mellemregninger, store løsningsbeviser eller mange math-blokke i træk.",
    "- Hold formler stabile og korte, så markdown-strukturen ikke bliver skrøbelig.",
    "- Hvis du er i tvivl, så brug klar tekst og en kort inline-formel i stedet for display math.",
    "- Skriv aldrig rå eller ufærdige LaTeX-markører. Der må ikke stå løse $...$, $$...$$ eller \\begin{...} i teksten.",
  ].join("\n");
}

export function buildMathFocusNotePrompt(plan: FocusNotePlan) {
  const subjectGuardLine =
    plan.resolvedSubjectFamily === "matematik"
      ? "- Folderen og materialet skal behandles som matematik. Ignorér emner, der ligner andre fag eller topic drift."
      : "- Materialet ligner matematik. Hold dig stramt til de givne topic-pakker og bland ikke andre fag ind.";

  const systemPrompt = [
    "Du hjælper en studerende med at skrive Fokusnoter i matematik ud fra allerede organiserede topic-pakker.",
    "Skriv til en gymnasieelev, som ikke er ekspert i emnet endnu.",
    "",
    "VIGTIGT:",
    "- Arbejd KUN ud fra matematik-vidensblokkene og topic-pakkerne nedenfor.",
    "- Den uploadede fils doc_chunks er eneste autoritet i dette spor.",
    "- Brug ikke frit baggrundsstof som selvstændig kilde, og tilføj ikke emner uden tydelig dækning i materialet.",
    "- Fokusnoten skal være en hybrid læringsside med intro, emneoversigt, nøgleformler og vidensblokke - fri for subject bleed.",
    subjectGuardLine,
    "- Skriv kun selve noten i Markdown.",
    "- Skriv elevvenligt, pædagogisk og i almindeligt sprog uden at blive vag.",
    "- Brug strukturen `## Matematik Fokusnote`, `## Emneoversigt`, `## Nøgleformler` og `## Vidensblokke`.",
    "- Undgå Logical Overview, Topic Deep Dives og Repetition som tunge note-sektioner.",
    "- Tilføj ingen point, badges, mastery, progression eller træningsscore.",
    "- Hver `###`-blok skal være en selvstændig undervisningsenhed med 2-4 korte sætninger.",
    "- Brug korte, stabile formler kun når de hjælper. Inline math er standard, display math er kun til sikre centralformler.",
    "- Du må højst have ét kort eksempel pr. blok.",
    "- Efter blokken må der ikke komme lange ekstra afsnit eller udledninger.",
    "- Undgå lange tekstblokke. Blokkene skal være lette at skimme.",
    "- Undgå rå chunk-opsummeringer og teknisk model-sprog.",
    "- Vis højst diskrete sidehenvisninger pr. blok; vis ikke chunk-id'er eller intern source mapping i selve noten.",
    "- Brug matematik-vidensblokkene som dit primære didaktiske råmateriale. Topic-pakkerne bruges til at kontrollere scope og detaljer.",
    "- Matematik-Fokusnoter må ikke kollapse i markdown. Hold derfor strukturen enkel og fast.",
    buildStableMathFocusNoteGuidelines(),
    "- Display-formler må kun bruges til centrale standardformler, definitioner, nøgle-relationer eller korte slutresultater.",
    "- Brug aldrig display-math til lange omskrivninger, flere ligninger under hinanden eller trinvis udledning.",
    "- Gør kort tydeligt, hvad en regel bruges til, og hvordan den typisk anvendes eller fortolkes.",
    "- Skeln tydeligt mellem metode, formel og anvendelse uden faste skabelonsætninger i hver blok.",
    "- Forklar kort, hvad en metode hjælper eleven med at opdage, forstå eller beregne.",
    "- Variér formuleringerne, så blokke ikke mekanisk starter med de samme vendinger.",
    "- Undgå at lyde som facit, lærer-note, essay eller intern outline. Skriv mere menneskeligt og forklarende.",
  ].join("\n");

  const userPrompt = [
    `Fil: ${plan.fileName}`,
    `Mappe: ${plan.folderName ?? "ukendt mappe"}`,
    `Kvalitetsprofil: ${plan.qualitySummary}`,
    "",
    "Lav matematik-Fokusnoter i denne stil:",
    "- Start med 2-4 korte intro-sætninger, fx om at materialet dækker centrale matematiske emner fra det valgte materiale.",
    "- Lav derefter en kort emneoversigt med de vigtigste hovedområder og deres faglige funktion.",
    "- Lav derefter få nøgleformler i tydelige formelbokse, kun når formlerne er sikre og centrale.",
    "- Vis derefter vidensblokke med tydelig `###`-titel og 2-4 korte sætninger.",
    "- Brug en central formel tydeligt, hvis vidensblokken har en sikker centralformel, men undgå at overfylde siden.",
    "- Brug notation diskret inline, hvis der kun er `notationExample`.",
    "- Brug højst ét kort eksempel eller én kort anvendelse pr. blok.",
    "- Formler med flere trin, flere ligninger eller udledning skal ikke med.",
    "- Der må ikke være \\begin{aligned}, andre multiline-miljøer eller rå/ufærdige LaTeX-markører i noten.",
    "- Forklar emnerne kort, roligt og forståeligt uden at gentage samme labels i hver blok.",
    "- Du må gerne bruge korte standardforklaringer af notation og metode, men kun når de støtter et emne, der allerede findes i materialet.",
    "- Tilføj ikke nye emner ud over det, som topic-pakkerne tydeligt dækker.",
    "- Drop repetition som default.",
    "- Tilføj ingen point, badges, mastery, progression, score eller trænings-UI.",
    "- Vis ikke nogen teknisk kilde- eller source mapping-sektion for brugeren.",
    "",
    "MATEMATIK-VIDENSBLOKKE (lag 4, udledt direkte fra filens kandidatstykker):",
    plan.mathKnowledgeBlocksText || "Ingen særskilte vidensblokke udledt.",
    "",
    "DEBUG-LAG (kun til scope-kontrol; vis ikke dette som en teknisk sektion i noten):",
    plan.mathLayerDebugText || "Ingen debug-lag udledt.",
    "",
    "TOPIC-PAKKER:",
    plan.clusterPacketsText,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function buildMathFocusNoteFromKnowledgeBlocks(plan: FocusNotePlan) {
  return buildMathFocusNoteFromBlocks({
    blocks: plan.mathKnowledgeBlocks,
    fileName: plan.fileName,
    folderName: plan.folderName,
    limit: 20,
  });
}

export function buildMathFocusNoteArtifactsFromKnowledgeBlocks(plan: FocusNotePlan) {
  return buildMathFocusNoteArtifactsFromBlocks({
    blocks: plan.mathKnowledgeBlocks,
    fileName: plan.fileName,
    folderName: plan.folderName,
    limit: 20,
  });
}
