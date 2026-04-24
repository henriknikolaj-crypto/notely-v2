const PROTECTED_MARKDOWN_SEGMENT_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
const PROTECTED_INLINE_MATH_SEGMENT_RE = /(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g;
const PROSE_CONTEXT_GUARD_RE =
  /\b(version|kapitel|afsnit|data|liste|list|array|json|payload|placeholder|kode|kodeeksempel|filnavn|sti|path|felt|field)\b/i;
const GREEK_WORDS: Record<string, string> = {
  alpha: "\\alpha",
  beta: "\\beta",
  gamma: "\\gamma",
  delta: "\\delta",
  epsilon: "\\epsilon",
  theta: "\\theta",
  lambda: "\\lambda",
  mu: "\\mu",
  pi: "\\pi",
  sigma: "\\sigma",
  phi: "\\phi",
  psi: "\\psi",
  omega: "\\omega",
};
const GREEK_WORD_RE = new RegExp(`(?<!\\\\)\\b(${Object.keys(GREEK_WORDS).join("|")})\\b`, "gi");
const INTEGRAL_PHRASE_RE =
  /\bintegral\s+fra\s+([^\s,;:!?]+)\s+til\s+([^\s,;:!?]+)\s+af\s+([A-Za-z0-9_'"()[\]\-+/*^√±\s]+?)\s+d([A-Za-z])\b/gi;
const EQUATION_LIKE_FRAGMENT_RE =
  /(^|[^\w$\\])([A-Za-z(][A-Za-z0-9_'"()[\]\s+\-/*^,]{0,30}=\s*[A-Za-z0-9_'"()[\]{}\\√±\s+\-/*^,]{1,60})(?=($|[!?;,](?:\s|$)|\.(?:\s|$)|\s+(?:og|eller|men|fordi|som|hvor|derfor|da)\b))/g;

function isProtectedMarkdownSegment(value: string) {
  return value.startsWith("```") || value.startsWith("~~~") || /^`[^`\n]*`$/.test(value);
}

function normalizeSharedMathText(value: string) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00AD/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\\{2,}(?=[A-Za-z])/g, "\\");
}

function normalizeInlineMath(value: string) {
  return normalizeSharedMathText(value).replace(/\s+/g, " ").trim();
}

function replaceGreekWords(value: string) {
  return value.replace(GREEK_WORD_RE, (_, word: string) => GREEK_WORDS[String(word ?? "").toLowerCase()] ?? word);
}

function hasVeryStrongMathCue(value: string) {
  return /(?:\+\/-|±|√|sqrt\b|\^|_|\\[A-Za-z]+|'\(|\b(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|phi|psi|omega)\b)/i.test(
    value,
  );
}

function normalizeShortMathExpressionBody(value: string) {
  let text = normalizeSharedMathText(value);

  text = text.replace(/\+\/-/g, "\\pm");
  text = text.replace(/±/g, "\\pm");
  text = replaceGreekWords(text);
  text = text.replace(/(?<!\\)sqrt\s*\(\s*([^()]+?)\s*\)/gi, (_, body: string) => `\\sqrt{${normalizeInlineMath(body)}}`);
  text = text.replace(/(?<!\\)sqrt\s+([A-Za-z0-9]+(?:_[A-Za-z0-9]+)?)/gi, (_, body: string) => `\\sqrt{${body}}`);
  text = text.replace(/√\s*\(\s*([^()]+?)\s*\)/g, (_, body: string) => `\\sqrt{${normalizeInlineMath(body)}}`);
  text = text.replace(/√\s*([A-Za-z0-9]+(?:_[A-Za-z0-9]+)?)/g, (_, body: string) => `\\sqrt{${body}}`);

  return normalizeInlineMath(text);
}

function hasStrongMathCue(value: string) {
  return /(?:\+\/-|±|√|sqrt\b|\^|_|\\[A-Za-z]+|'\(|\[[^\]]+\]|\b(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|phi|psi|omega)\b)/i.test(value);
}

function lhsLooksVariableLike(lhs: string) {
  const compact = normalizeSharedMathText(lhs).replace(/\s+/g, "");
  if (!compact) return false;
  if (compact.length <= 4) return true;
  return /[_'^()\d+\-/*[\]]/.test(compact);
}

function hasTooMuchProse(value: string) {
  const proseWords = (value.match(/[A-Za-z]{4,}/g) ?? []).filter((word) => {
    const lower = word.toLowerCase();
    return !(lower in GREEK_WORDS) && !["sqrt", "frac", "vec", "sin", "cos", "tan", "log", "ln"].includes(lower);
  });
  return proseWords.length > 1;
}

function looksLikeShortMathExpression(value: string, lineContext?: string) {
  const text = normalizeSharedMathText(value).trim();
  if (!text || text.length < 3 || text.length > 90) return false;
  if (text.includes("$") || text.includes("`") || !text.includes("=")) return false;

  const eqIndex = text.indexOf("=");
  const lhs = text.slice(0, eqIndex).trim();
  const rhs = text.slice(eqIndex + 1).trim();

  if (!lhs || !rhs) return false;
  if (!lhsLooksVariableLike(lhs)) return false;
  if (!hasStrongMathCue(text) && !(/[0-9]/.test(lhs) || /[0-9]/.test(rhs))) return false;
  if (hasTooMuchProse(text)) return false;
  if (lineContext && PROSE_CONTEXT_GUARD_RE.test(lineContext) && !hasVeryStrongMathCue(text)) return false;
  if (/^\s*[A-Za-z]\s*=\s*\[[^\]]+\]\s*$/.test(text) && lineContext && lineContext.trim() !== text) return false;

  return true;
}

function normalizeShortMathishLine(line: string) {
  let next = line.replace(
    INTEGRAL_PHRASE_RE,
    (_match: string, lower: string, upper: string, body: string, variable: string) =>
      `$\\int_${normalizeInlineMath(lower)}^${normalizeInlineMath(upper)} ${normalizeShortMathExpressionBody(body)} \\, d${variable}$`,
  );

  next = next.replace(EQUATION_LIKE_FRAGMENT_RE, (match: string, prefix: string, body: string) => {
    if (!looksLikeShortMathExpression(body, line)) return match;
    return `${prefix}$${normalizeShortMathExpressionBody(body)}$`;
  });

  return next;
}

function normalizeShortMathishText(value: string) {
  return value
    .split(PROTECTED_INLINE_MATH_SEGMENT_RE)
    .map((segment) => {
      if (!segment || segment.startsWith("$")) return segment;
      return segment
        .split("\n")
        .map(normalizeShortMathishLine)
        .join("\n");
    })
    .join("");
}

function shouldCollapseSimpleBlockMath(lines: string[]) {
  if (lines.length <= 1) return false;
  if (lines.some((line) => /\\begin\{|\\end\{|\\tag\{|\\label\{|\\nonumber\b|\\cr\b|&/.test(line))) return false;
  if (lines.some((line) => /\\\\\s*$/.test(line))) return false;
  return true;
}

function normalizeBlockMath(value: string) {
  const normalized = normalizeSharedMathText(value)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";
  if (shouldCollapseSimpleBlockMath(lines)) return lines.join(" ");
  return lines.join("\n");
}

function wrapStandaloneMathLines(segment: string) {
  return segment
    .split("\n")
    .map((line) => {
      const match = /^(\s*(?:(?:[-*+]\s+)|(?:\d+[.)]\s+)|(?:>\s+))*)(.*)$/.exec(line);
      if (!match) return line;

      const prefix = match[1] ?? "";
      const content = (match[2] ?? "").trim();
      if (!content || content.includes("$") || content.includes("`")) return line;
      if (!/^\\{1,2}[A-Za-z]/.test(content)) return line;

      const stripped = normalizeSharedMathText(content)
        .replace(/\\[A-Za-z]+/g, "")
        .replace(/\{[^{}]*\}/g, "")
        .replace(/[0-9\s()[\],.;:+\-*/=^_|<>]/g, "");

      if (stripped.length > 0) return line;
      return `${prefix}$${normalizeInlineMath(content)}$`;
    })
    .join("\n");
}

function normalizePlainMarkdownSegment(segment: string) {
  let text = normalizeSharedMathText(segment);

  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `$$\n${normalizeBlockMath(body)}\n$$`);
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, body: string) => `$$\n${normalizeBlockMath(body)}\n$$`);
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${normalizeInlineMath(body)}$`);
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, body: string) => `$${normalizeInlineMath(body)}$`);
  text = normalizeShortMathishText(text);

  return wrapStandaloneMathLines(text);
}

export function normalizeMathContent(input: string) {
  return String(input ?? "")
    .split(PROTECTED_MARKDOWN_SEGMENT_RE)
    .map((segment) => (segment && !isProtectedMarkdownSegment(segment) ? normalizePlainMarkdownSegment(segment) : segment))
    .join("");
}
