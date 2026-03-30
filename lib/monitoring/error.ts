import * as Sentry from "@sentry/nextjs";

export type MonitoringErrorContext = {
  flow?: string;
  route?: string;
  ownerId?: string | null;
  plan?: string | null;
  fileId?: string | null;
  folderId?: string | null;
  jobId?: string | null;
  requestId?: string | null;
  status?: number | null;
  code?: string | null;
};

const EXPECTED_CODE_PATTERNS = [
  "QUOTA",
  "LIMIT",
  "UNAUTHORIZED",
  "INVALID_",
  "METHOD_NOT_ALLOWED",
  "MISSING_ID",
  "NOT_ALLOWED",
];

const EXPECTED_MESSAGE_PATTERNS = [
  "quota exceeded",
  "limit reached",
  "monthly limit",
  "alle træner-runder",
  "login kræves",
  "unauthorized",
  "forbidden",
  "aborterror",
  "aborted",
  "cancelled",
  "canceled",
];

function getErrorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (error && typeof error === "object" && "name" in error) {
    return String((error as { name?: unknown }).name ?? "");
  }
  return "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return "";
}

function stringifyStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function lower(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function matchesExpectedCode(code?: string | null): boolean {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return EXPECTED_CODE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function matchesExpectedMessage(text: string): boolean {
  const normalized = lower(text);
  if (!normalized) return false;
  return EXPECTED_MESSAGE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function eventText(event: any): string {
  const values = Array.isArray(event?.exception?.values) ? event.exception.values : [];
  return [
    event?.message,
    ...values.flatMap((value: any) => [value?.type, value?.value]),
    event?.tags?.code,
    event?.tags?.route,
    event?.contexts?.notely?.code,
  ]
    .filter(Boolean)
    .join(" ");
}

export function getClientSentryDsn(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
}

export function getServerSentryDsn(): string | undefined {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
}

export function getSentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

function parseEnvBoolean(value: string | undefined): boolean | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function isSentryEnabled(): boolean {
  const dsn = getServerSentryDsn();
  if (!dsn) return false;

  const explicitFlag =
    parseEnvBoolean(process.env.SENTRY_ENABLED) ??
    parseEnvBoolean(process.env.NEXT_PUBLIC_SENTRY_ENABLED);

  if (explicitFlag != null) {
    return explicitFlag;
  }

  return process.env.NODE_ENV === "production";
}

export function shouldIgnoreError(error: unknown, context?: Pick<MonitoringErrorContext, "status" | "code">): boolean {
  const status = context?.status ?? null;
  if (typeof status === "number" && status >= 400 && status < 500) return true;

  const code = context?.code ?? null;
  if (matchesExpectedCode(code)) return true;

  const name = getErrorName(error);
  if (name === "AbortError") return true;

  const message = getErrorMessage(error);
  return matchesExpectedMessage(`${name} ${message}`);
}

export function shouldDropSentryEvent(event: any, hint?: { originalException?: unknown } | null): boolean {
  const notelyContext = event?.contexts?.notely;
  const status =
    stringifyStatus(notelyContext?.status) ??
    stringifyStatus(event?.tags?.status) ??
    stringifyStatus(event?.extra?.status);
  const code =
    (typeof notelyContext?.code === "string" ? notelyContext.code : null) ??
    (typeof event?.tags?.code === "string" ? event.tags.code : null);

  if (shouldIgnoreError(hint?.originalException, { status, code })) return true;
  return matchesExpectedMessage(eventText(event));
}

export function createSentryBeforeSend() {
  return function beforeSend(event: any, hint?: { originalException?: unknown } | null) {
    if (shouldDropSentryEvent(event, hint ?? null)) {
      return null;
    }
    return event;
  };
}

export function captureException(error: unknown, context: MonitoringErrorContext = {}) {
  if (!isSentryEnabled() || shouldIgnoreError(error, context)) {
    return;
  }

  Sentry.withScope((scope) => {
    scope.setLevel("error");

    if (context.flow) scope.setTag("flow", context.flow);
    if (context.route) scope.setTag("route", context.route);
    if (context.plan) scope.setTag("plan", context.plan);
    if (context.code) scope.setTag("code", context.code);
    if (context.status != null) scope.setTag("status", String(context.status));
    if (context.requestId) scope.setTag("request_id", context.requestId);
    if (context.ownerId) scope.setUser({ id: context.ownerId });

    scope.setContext("notely", {
      flow: context.flow ?? null,
      route: context.route ?? null,
      owner_id: context.ownerId ?? null,
      plan: context.plan ?? null,
      file_id: context.fileId ?? null,
      folder_id: context.folderId ?? null,
      job_id: context.jobId ?? null,
      request_id: context.requestId ?? null,
      status: context.status ?? null,
      code: context.code ?? null,
    });

    Sentry.captureException(error instanceof Error ? error : new Error(getErrorMessage(error) || "Unknown error"));
  });
}
