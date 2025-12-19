const looksDanish = (text) => {
  if (!text) return false;
  const t = text.toLowerCase();
  let score = 0;
  if (/[æøå]/.test(t)) score += 2;
  const signals = [" og ", " ikke ", " der ", " som ", " det ", " den ", " på ", " med ", " for ", " til ", " af ", " fra ", " er ", " jeg ", " du ", " vi "];
  let hits = 0;
  for (const w of signals) if (t.includes(w)) hits++;
  score += Math.min(hits, 6);
  return score >= 4;
};

const da = "Det her er en dansk sætning med æ, ø og å, og den er ikke på engelsk.";
const en = "This is an English sentence without Danish letters and stopwords.";
console.log("DA test =>", looksDanish(da)); // true forventes
console.log("EN test =>", looksDanish(en)); // false forventes

