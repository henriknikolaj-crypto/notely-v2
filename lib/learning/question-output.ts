import "server-only";

export type QuestionOutputSource =
  | "json"
  | "json_fragment"
  | "json_field"
  | "prompt_fields"
  | "plain_text"
  | "plain_list"
  | "none";

export type QuestionOutputDiagnostics = {
  finishReason: string | null;
  rawLength: number;
  rawPreview: string;
  parseOk: boolean;
  extractedFrom: QuestionOutputSource;
  contentMissing: boolean;
  questionLength: number;
  questionCount: number;
};

type ParsedJsonCandidate = {
  payload: any;
  source: "json" | "json_fragment";
};

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

function tryParseJsonCandidate(raw: string): ParsedJsonCandidate | null {
  const direct = stripCodeFences(raw);
  const candidates: Array<{ text: string; source: "json" | "json_fragment" }> = [];
  if (direct) {
    candidates.push({ text: direct, source: "json" });
  }

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
      // keep trying
    }
  }

  return null;
}

function normalizeQuestionCandidate(value: string) {
  return trimWrappingQuotes(collapseWhitespace(value)).replace(/^[\-*]\s*/, "").trim();
}

function extractQuotedField(raw: string, fieldName: string) {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "is");
  const match = pattern.exec(raw);
  if (!match?.[1]) return "";
  return normalizeQuestionCandidate(decodeJsonString(match[1]));
}

function extractAllQuotedFields(raw: string, fieldName: string) {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "gis");
  const out: string[] = [];
  for (const match of raw.matchAll(pattern)) {
    const value = normalizeQuestionCandidate(decodeJsonString(match[1] ?? ""));
    if (value) out.push(value);
  }
  return out;
}

function extractLooseQuestionAfterLabel(raw: string) {
  const match = /(?:^|\n)\s*(?:question|spørgsmål)\s*[:\-]\s*(.+)$/im.exec(raw);
  if (!match?.[1]) return "";

  const candidate = match[1]
    .split(/\n+/)[0]
    .replace(/[}\]]+$/, "")
    .replace(/,$/, "")
    .trim();
  return normalizeQuestionCandidate(candidate);
}

function salvagePlainQuestion(raw: string) {
  const cleaned = stripCodeFences(raw);
  const labeled = extractLooseQuestionAfterLabel(cleaned);
  if (labeled) return labeled;

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^[\[\]{},"']+$/.test(line))
    .map((line) => line.replace(/^\s*(?:q?\d+[.)-]|[-*])\s*/, "").trim())
    .filter(Boolean);

  if (!lines.length) return "";

  if (lines.length === 1) return normalizeQuestionCandidate(lines[0]);

  const firstLine = normalizeQuestionCandidate(lines[0]);
  if (firstLine) return firstLine;

  return normalizeQuestionCandidate(lines.slice(0, 2).join(" "));
}

function salvagePlainQuestionList(raw: string) {
  const cleaned = stripCodeFences(raw);
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const numbered = lines
    .map((line) => line.replace(/^\s*(?:q?\d+[.)-]|[-*])\s*/, "").trim())
    .filter((line, index) => /^\s*(?:q?\d+[.)-]|[-*])\s*/.test(lines[index]) && line);
  if (numbered.length > 0) return numbered.map(normalizeQuestionCandidate).filter(Boolean);

  const paragraphs = cleaned
    .split(/\n\s*\n/g)
    .map((part) => normalizeQuestionCandidate(part))
    .filter(Boolean);
  if (paragraphs.length > 0) return paragraphs;

  const single = salvagePlainQuestion(cleaned);
  return single ? [single] : [];
}

export function parseSingleQuestionOutput(raw: string, finishReason: string | null = null) {
  const safeRaw = String(raw ?? "");
  const parsed = tryParseJsonCandidate(safeRaw);
  let extractedFrom: QuestionOutputSource = "none";
  let question = "";

  if (parsed) {
    const candidate = normalizeQuestionCandidate(String(parsed.payload?.question ?? ""));
    if (candidate) {
      question = candidate;
      extractedFrom = parsed.source;
    }
  }

  if (!question) {
    const quoted = extractQuotedField(safeRaw, "question");
    if (quoted) {
      question = quoted;
      extractedFrom = "json_field";
    }
  }

  if (!question) {
    const plain = salvagePlainQuestion(safeRaw);
    if (plain) {
      question = plain;
      extractedFrom = "plain_text";
    }
  }

  const diagnostics: QuestionOutputDiagnostics = {
    finishReason,
    rawLength: safeRaw.length,
    rawPreview: buildPreview(safeRaw),
    parseOk: !!parsed,
    extractedFrom,
    contentMissing: !question,
    questionLength: question.length,
    questionCount: question ? 1 : 0,
  };

  return { question, diagnostics };
}

export function parseQuestionListOutput(raw: string, finishReason: string | null = null) {
  const safeRaw = String(raw ?? "");
  const parsed = tryParseJsonCandidate(safeRaw);
  let extractedFrom: QuestionOutputSource = "none";
  let questions: string[] = [];

  if (parsed) {
    const arr = Array.isArray(parsed.payload?.questions)
      ? parsed.payload.questions
      : Array.isArray(parsed.payload)
        ? parsed.payload
        : [];
    const parsedQuestions = arr
      .map((item: any) =>
        typeof item === "string"
          ? normalizeQuestionCandidate(item)
          : normalizeQuestionCandidate(String(item?.prompt ?? item?.question ?? ""))
      )
      .filter(Boolean);
    if (parsedQuestions.length > 0) {
      questions = parsedQuestions;
      extractedFrom = parsed.source;
    }
  }

  if (!questions.length) {
    const quotedPrompts = extractAllQuotedFields(safeRaw, "prompt");
    if (quotedPrompts.length > 0) {
      questions = quotedPrompts;
      extractedFrom = "prompt_fields";
    }
  }

  if (!questions.length) {
    const plain = salvagePlainQuestionList(safeRaw);
    if (plain.length > 0) {
      questions = plain;
      extractedFrom = "plain_list";
    }
  }

  const diagnostics: QuestionOutputDiagnostics = {
    finishReason,
    rawLength: safeRaw.length,
    rawPreview: buildPreview(safeRaw),
    parseOk: !!parsed,
    extractedFrom,
    contentMissing: questions.length === 0,
    questionLength: questions[0]?.length ?? 0,
    questionCount: questions.length,
  };

  return { questions, diagnostics };
}
