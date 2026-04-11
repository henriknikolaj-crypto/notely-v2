export function buildVirksomhedsokonomiTrainerGeneratePromptAddendum() {
  return [
    "",
    "Virksomhedsøkonomi-spørgsmålsfokus:",
    "- Foretræk spørgsmål der kræver aktiv brug af model eller teori på den konkrete virksomhed eller case.",
    "- Hvis materialet indeholder tal eller nøgletal, så lad spørgsmålet lægge op til fortolkning og vurdering, ikke kun gengivelse.",
    "- Spørg gerne så eleven tydeligt skal koble case, teori og konklusion sammen.",
    "- Vinklen må gerne invitere til analyse og begrundet vurdering frem for løs redegørelse.",
  ].join("\n");
}
