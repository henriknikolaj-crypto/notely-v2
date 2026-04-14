export type UploadActivityPhase = "uploading" | "classifying" | "ocr" | "processing" | "ready" | "background" | "failed";

export type UploadActivity = {
  phase: UploadActivityPhase;
  label: string;
  detail: string | null;
  normalizedStatus: string;
  normalizedStage: string;
};

const READY_TOKENS = new Set(["ready", "succeeded", "finished", "completed", "first_ready"]);
const BACKGROUND_TOKENS = new Set(["deep_processing"]);
const FAILED_TOKENS = new Set(["failed"]);
const OCR_TOKENS = new Set(["ocr_started"]);
const CLASSIFYING_TOKENS = new Set(["pdf_extract_started", "pdf_extract_finished", "first_processing"]);
const UPLOADING_TOKENS = new Set([
  "queued",
  "upload_started",
  "file_buffered",
  "storage_upload_started",
  "storage_upload_finished",
]);

export function normalizeUploadStatusToken(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function isTerminalUploadActivityPhase(phase: UploadActivityPhase | null | undefined) {
  return phase === "ready" || phase === "background" || phase === "failed";
}

export function isTerminalUploadActivity(args: {
  status?: string | null;
  stage?: string | null;
}) {
  return isTerminalUploadActivityPhase(resolveUploadActivity(args).phase);
}

export function resolveUploadActivity(args: {
  status?: string | null;
  stage?: string | null;
}): UploadActivity {
  const normalizedStatus = normalizeUploadStatusToken(args.status);
  const normalizedStage = normalizeUploadStatusToken(args.stage);

  if (FAILED_TOKENS.has(normalizedStatus) || FAILED_TOKENS.has(normalizedStage)) {
    return {
      phase: "failed",
      label: "Fejlede",
      detail: "Klargøring fejlede",
      normalizedStatus,
      normalizedStage,
    };
  }

  if (BACKGROUND_TOKENS.has(normalizedStatus) || BACKGROUND_TOKENS.has(normalizedStage)) {
    return {
      phase: "background",
      label: "Forbedres",
      detail: "Materialet er klar og forbedres i baggrunden",
      normalizedStatus,
      normalizedStage,
    };
  }

  if (READY_TOKENS.has(normalizedStatus) || READY_TOKENS.has(normalizedStage)) {
    return {
      phase: "ready",
      label: "Klar",
      detail: "Materialet er klar",
      normalizedStatus,
      normalizedStage,
    };
  }

  if (OCR_TOKENS.has(normalizedStatus) || OCR_TOKENS.has(normalizedStage)) {
    return {
      phase: "ocr",
      label: "OCR i gang",
      detail: "Vi læser siderne med OCR",
      normalizedStatus,
      normalizedStage,
    };
  }

  if (CLASSIFYING_TOKENS.has(normalizedStatus) || CLASSIFYING_TOKENS.has(normalizedStage)) {
    return {
      phase: "classifying",
      label: "Klassificeres",
      detail: "Vi afgør den hurtigste sikre behandlingsvej",
      normalizedStatus,
      normalizedStage,
    };
  }

  if (UPLOADING_TOKENS.has(normalizedStatus) || UPLOADING_TOKENS.has(normalizedStage)) {
    return {
      phase: "uploading",
      label: "Uploades",
      detail: "Filen uploades og registreres",
      normalizedStatus,
      normalizedStage,
    };
  }

  return {
    phase: "processing",
    label: "Klargøres",
    detail: "Materialet klargøres",
    normalizedStatus,
    normalizedStage,
  };
}
