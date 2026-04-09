import "server-only";

function collapseMathWhitespace(value: string) {
  return value.replace(/[ \t]+/g, " ").trim();
}

export function sanitizeTrainerPlainText(raw: unknown) {
  let text = String(raw ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return "";

  text = text
    .replace(/\\cdot/g, "*")
    .replace(/\\times/g, "*")
    .replace(/\\text\s*\{([^}]*)\}/g, "$1")
    .replace(/\\mathrm\s*\{([^}]*)\}/g, "$1")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
    .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1");

  text = text
    .split("\n")
    .map((line) => line.replace(/^\s*[*\-•]\s+/, "").replace(/^\s*\d+[.)]\s+/, "").trimEnd())
    .join("\n");

  text = text
    .split("\n")
    .map((line) => collapseMathWhitespace(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
