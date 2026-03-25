export function normalizeFlashcardMathText(input: string): string {
  return String(input ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00AD/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function hasSuspiciousFlashcardChars(input: string): boolean {
  return /[\uFFFD\uE000-\uF8FF]/u.test(String(input ?? ""));
}

export function formatSuspiciousPreview(input: string, maxLen = 180) {
  const text = String(input ?? "");
  const preview = text.replace(/\s+/g, " ").slice(0, maxLen);
  const chars = Array.from(text)
    .filter((ch) => /[\uFFFD\uE000-\uF8FF]/u.test(ch))
    .slice(0, 10)
    .map((ch) => ({
      char: ch,
      codePoint: `U+${ch.codePointAt(0)?.toString(16).toUpperCase()}`,
    }));

  return { preview, chars };
}
