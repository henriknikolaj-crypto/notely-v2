import "server-only";

export type McParsedOption = {
  text: string;
  isCorrect: boolean;
};

export type McOutputSource =
  | "json"
  | "json_fragment"
  | "question_field"
  | "options_regex"
  | "mixed_salvage"
  | "none";

export type McResponseTextSource =
  | "message_content"
  | "message_content_parts"
  | "output_text"
  | "output_content_text"
  | "response_content_text"
  | "none";

export type McResponseShapeDiagnostics = {
  topLevelKeys: string[];
  choiceCount: number;
  finishReason: string | null;
  messageKeys: string[];
  messageContentKind: string;
  messageContentLength: number;
  responseTextSource: McResponseTextSource;
  hasOutputText: boolean;
  outputItemCount: number;
  outputTextPartCount: number;
  refusalPresent: boolean;
  refusalPreview: string;
  completionTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

export type McOutputDiagnostics = {
  finishReason: string | null;
  rawLength: number;
  rawPreview: string;
  parseOk: boolean;
  extractedFrom: McOutputSource;
  contentMissing: boolean;
  questionLength: number;
  optionCount: number;
  correctOptionCount: number;
  explanationLength: number;
};

type ParsedJsonCandidate = {
  payload: any;
  source: "json" | "json_fragment";
};

function safeObjectKeys(value: unknown, limit = 12) {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value as Record<string, unknown>).slice(0, limit);
}

function collapseWhitespace(value: string) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function buildPreview(value: string, maxChars = 200) {
  const compact = collapseWhitespace(value);
  if (!compact) return "";
  return compact.length <= maxChars ? compact : `${compact.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
}

function stripCodeFences(raw: string) {
  return String(raw ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function trimWrappingQuotes(value: string) {
  const trimmed = String(value ?? "").trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\\\/g, "\\");
  }
}

function normalizeTextCandidate(value: string) {
  return trimWrappingQuotes(collapseWhitespace(value)).replace(/^[\-*]\s*/, "").trim();
}

function extractTextFromParts(parts: unknown[]): string {
  const out: string[] = [];

  for (const part of parts) {
    if (typeof part === "string") {
      const text = normalizeTextCandidate(part);
      if (text) out.push(text);
      continue;
    }

    const candidates = [
      typeof (part as any)?.text === "string" ? (part as any).text : "",
      typeof (part as any)?.output_text === "string" ? (part as any).output_text : "",
      typeof (part as any)?.value === "string" ? (part as any).value : "",
    ];

    for (const candidate of candidates) {
      const text = normalizeTextCandidate(candidate);
      if (text) out.push(text);
    }
  }

  return out.join("\n").trim();
}

function extractRefusalPreview(message: any) {
  if (typeof message?.refusal === "string") {
    return buildPreview(message.refusal, 120);
  }
  if (Array.isArray(message?.refusal)) {
    return buildPreview(
      message.refusal
        .map((entry: any) => {
          if (typeof entry === "string") return entry;
          if (typeof entry?.text === "string") return entry.text;
          if (typeof entry?.refusal === "string") return entry.refusal;
          return "";
        })
        .filter(Boolean)
        .join("\n"),
      120,
    );
  }
  return "";
}

export function extractMcResponseText(response: any): {
  text: string;
  source: McResponseTextSource;
  shape: McResponseShapeDiagnostics;
} {
  const choice = response?.choices?.[0] ?? null;
  const message = choice?.message ?? null;
  const messageContent = message?.content;
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  const output = Array.isArray(response?.output) ? response.output : [];
  const responseContent = Array.isArray(response?.content) ? response.content : [];
  const outputText = typeof response?.output_text === "string" ? normalizeTextCandidate(response.output_text) : "";
  const messageText =
    typeof messageContent === "string"
      ? normalizeTextCandidate(messageContent)
      : Array.isArray(messageContent)
        ? extractTextFromParts(messageContent)
        : "";
  const outputContentText = output
    .map((item: any) => extractTextFromParts(Array.isArray(item?.content) ? item.content : []))
    .filter(Boolean)
    .join("\n")
    .trim();
  const responseContentText = extractTextFromParts(responseContent);

  let text = "";
  let source: McResponseTextSource = "none";

  if (typeof messageContent === "string" && messageText) {
    text = messageText;
    source = "message_content";
  } else if (Array.isArray(messageContent) && messageText) {
    text = messageText;
    source = "message_content_parts";
  } else if (outputText) {
    text = outputText;
    source = "output_text";
  } else if (outputContentText) {
    text = outputContentText;
    source = "output_content_text";
  } else if (responseContentText) {
    text = responseContentText;
    source = "response_content_text";
  }

  const usage = response?.usage ?? null;
  const completionTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null;
  const totalTokens = typeof usage?.total_tokens === "number" ? usage.total_tokens : null;
  const reasoningTokens =
    typeof usage?.completion_tokens_details?.reasoning_tokens === "number"
      ? usage.completion_tokens_details.reasoning_tokens
      : null;
  const refusalPreview = extractRefusalPreview(message);

  return {
    text,
    source,
    shape: {
      topLevelKeys: safeObjectKeys(response),
      choiceCount: Array.isArray(response?.choices) ? response.choices.length : 0,
      finishReason,
      messageKeys: safeObjectKeys(message),
      messageContentKind: Array.isArray(messageContent) ? "array" : typeof messageContent,
      messageContentLength: messageText.length,
      responseTextSource: source,
      hasOutputText: Boolean(outputText),
      outputItemCount: output.length,
      outputTextPartCount: output.reduce((count: number, item: any) => {
        const content = Array.isArray(item?.content) ? item.content : [];
        return count + content.filter((part: any) => typeof part?.text === "string" || typeof part?.output_text === "string").length;
      }, 0),
      refusalPresent: Boolean(refusalPreview),
      refusalPreview,
      completionTokens,
      reasoningTokens,
      totalTokens,
    },
  };
}

function tryParseJsonCandidate(raw: string): ParsedJsonCandidate | null {
  const direct = stripCodeFences(raw);
  const candidates: Array<{ text: string; source: "json" | "json_fragment" }> = [];
  if (direct) candidates.push({ text: direct, source: "json" });

  const start = direct.indexOf("{");
  const end = direct.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const fragment = direct.slice(start, end + 1).trim();
    if (fragment && fragment !== direct) {
      candidates.push({ text: fragment, source: "json_fragment" });
    }
  }

  for (const candidate of candidates) {
    try {
      return {
        payload: JSON.parse(candidate.text),
        source: candidate.source,
      };
    } catch {
      // Keep trying.
    }
  }

  return null;
}

function extractQuotedField(raw: string, fieldName: string) {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "is");
  const match = pattern.exec(raw);
  if (!match?.[1]) return "";
  return normalizeTextCandidate(decodeJsonString(match[1]));
}

function normalizeOptionCandidate(option: any): McParsedOption | null {
  const text =
    typeof option === "string"
      ? normalizeTextCandidate(option)
      : normalizeTextCandidate(String(option?.text ?? ""));
  if (!text) return null;
  return {
    text,
    isCorrect: typeof option === "object" && option != null ? option.isCorrect === true : false,
  };
}

function extractOptionsFromRaw(raw: string): McParsedOption[] {
  const cleaned = stripCodeFences(raw);
  const optionsMatch = /"options"\s*:\s*\[([\s\S]*)/i.exec(cleaned);
  const optionsSource = optionsMatch?.[1] ?? cleaned;
  const objectMatches = optionsSource.match(/\{[\s\S]*?\}/g) ?? [];
  const out: McParsedOption[] = [];

  for (const fragment of objectMatches) {
    const textMatch = /"text"\s*:\s*"((?:\\.|[^"\\])*)"/i.exec(fragment);
    const correctMatch = /"isCorrect"\s*:\s*(true|false)/i.exec(fragment);
    if (!textMatch?.[1] || !correctMatch?.[1]) continue;

    const text = normalizeTextCandidate(decodeJsonString(textMatch[1]));
    if (!text) continue;

    out.push({
      text,
      isCorrect: correctMatch[1].toLowerCase() === "true",
    });
  }

  return out;
}

export function buildMcSystemPrompt(extraRules: string[] = []) {
  const extraBlock =
    extraRules.length > 0
      ? `\nEKSTRA KRAV:\n${extraRules.map((rule) => `- ${rule}`).join("\n")}\n`
      : "";

  return `
Lav ét multiple choice-spørgsmål ud fra den givne kontekst.
- Skriv på dansk.
- Brug kun konteksten.
- Returnér kun ét kompakt JSON-objekt.
- Ingen markdown, ingen kodeblok, ingen ekstra tekst.
- Brug kun felterne "question", "options" og "explanation".
- "question": kort, 1 sætning.
- "options": præcis 4 svarmuligheder.
- Præcis 1 option skal have "isCorrect": true.
- "explanation": meget kort, helst 1 sætning.
${extraBlock}
JSON:
{"question":"...","options":[{"text":"...","isCorrect":true},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false}],"explanation":"..."}
`.trim();
}

export function parseMcQuestionOutput(raw: string, finishReason: string | null = null) {
  const safeRaw = String(raw ?? "");
  const parsed = tryParseJsonCandidate(safeRaw);
  let question = "";
  let options: McParsedOption[] = [];
  let explanation: string | null = null;
  let extractedFrom: McOutputSource = "none";

  if (parsed) {
    question = normalizeTextCandidate(String(parsed.payload?.question ?? ""));
    options = Array.isArray(parsed.payload?.options)
      ? parsed.payload.options
          .map(normalizeOptionCandidate)
          .filter((value: McParsedOption | null): value is McParsedOption => !!value)
      : [];
    explanation = normalizeTextCandidate(String(parsed.payload?.explanation ?? "")) || null;
    extractedFrom = parsed.source;
  }

  if (!question) {
    const salvagedQuestion = extractQuotedField(safeRaw, "question");
    if (salvagedQuestion) {
      question = salvagedQuestion;
      extractedFrom = extractedFrom === "none" ? "question_field" : "mixed_salvage";
    }
  }

  if (options.length === 0) {
    const salvagedOptions = extractOptionsFromRaw(safeRaw);
    if (salvagedOptions.length > 0) {
      options = salvagedOptions;
      extractedFrom = extractedFrom === "none" ? "options_regex" : "mixed_salvage";
    }
  }

  if (!explanation) {
    explanation = extractQuotedField(safeRaw, "explanation") || null;
  }

  const diagnostics: McOutputDiagnostics = {
    finishReason,
    rawLength: safeRaw.length,
    rawPreview: buildPreview(safeRaw),
    parseOk: !!parsed,
    extractedFrom,
    contentMissing: !question || options.length === 0,
    questionLength: question.length,
    optionCount: options.length,
    correctOptionCount: options.filter((option) => option.isCorrect).length,
    explanationLength: explanation?.length ?? 0,
  };

  return { question, options, explanation, diagnostics };
}
