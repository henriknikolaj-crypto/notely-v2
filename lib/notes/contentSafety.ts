const RAW_NEXT_PAYLOAD_PATTERNS = [
  /^\s*\d+\s*:\s*\[/,
  /^\s*\d+\s*:\s*\{/,
  /self\.__next_f\.push/i,
  /"\$Sreact\.(?:fragment|suspense)"/i,
  /NEXT_HTTP_ERROR_FALLBACK/i,
  /\bnot-found\b.{0,120}\bchildren\b/i,
  /<html[\s>]/i,
  /<!doctype\s+html/i,
  /content-type:\s*text\/x-component/i,
];

const MATH_SIGNAL_PATTERNS = [
  /\$\$/,
  /\\(?:sqrt|frac|sin|cos|tan|cdot|pm)\b/i,
  /\bf'\(x\)\b/i,
  /\bx\^2\b/i,
  /\bd\s*=\s*b\^2\s*-\s*4/i,
  /\b(?:diskriminant|løsningsformlen|loesningsformlen|toppunktsformlen|cosinusrelation|sinusrelation)\b/i,
  /\b(?:afstandsformlen|cirklens ligning|tangentligning|monotoni|differentialregning|optimering)\b/i,
];

const UNSAFE_MATH_MARKDOWN_PATTERNS = [
  /\b(?:Bruges til|Eksempel|Pas på|Pas paa|Notation|Det vil sige)\b[\s\S]{0,220}(?:---|####|###|##\s*(?:Vidensblokke|Nøgleformler))/i,
  /(?:^|\s)_(?:Metode|Regel|Begreb|Faldgrube|Eksempel)\b/i,
  /\*\*Formel:\*\*/i,
  /(?:---[\s\S]{0,80}####|####[\s\S]{0,80}---)/i,
  /(?:^|[^\n])\$\$[^\n]*[A-Za-zÆØÅæøå]{3,}[^\n]*\$\$(?:[^\n]|$)/i,
  /(?:^|[^\n])[A-Za-zÆØÅæøå]{3,}[^\n]*\$\$[^\n]*(?:Bruges til|Eksempel|Pas på|Pas paa|Notation)\b/i,
];

export function looksLikeRawNextResponse(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  const sample = text.slice(0, 6000);
  return RAW_NEXT_PAYLOAD_PATTERNS.some((pattern) => pattern.test(sample));
}

export function renderableNoteContent(value: string | null | undefined) {
  const text = String(value ?? "");
  return looksLikeRawNextResponse(text) ? "" : text;
}

export function looksLikeUnsafeMathFocusMarkdown(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text || looksLikeRawNextResponse(text)) return false;
  const sample = text.slice(0, 8000);
  const looksMathLike = MATH_SIGNAL_PATTERNS.some((pattern) => pattern.test(sample));
  if (!looksMathLike) return false;
  return UNSAFE_MATH_MARKDOWN_PATTERNS.some((pattern) => pattern.test(sample));
}

export function noteContentFallbackMessage(kind: "generic" | "math_focus_unsafe" = "generic") {
  if (kind === "math_focus_unsafe") {
    return "Denne matematiknote kunne ikke vises korrekt. Generér noten igen.";
  }
  return "Noten kunne ikke vises korrekt. Prøv at åbne eller generere den igen.";
}
