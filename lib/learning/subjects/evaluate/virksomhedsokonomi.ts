export function buildVirksomhedsokonomiTrainerPromptAddendum() {
  return [
    "",
    "Virksomhedsøkonomi-fokus:",
    "- Fang når en model nævnes, men ikke faktisk bruges til at analysere casen.",
    "- Skeln tydeligt mellem redegørelse og analyse: eleven skal bruge teori aktivt på virksomheden eller casen.",
    "- Hvis tal eller nøgletal bruges, så vurder om de bliver fortolket og ikke kun refereret.",
    "- Vurder om teori, model og case kobles tydeligt sammen i argumentationen.",
    "- Vær opmærksom på upræcis begrebsbrug, løs vurdering og konklusioner der ikke samler argumentet.",
  ].join("\n");
}
