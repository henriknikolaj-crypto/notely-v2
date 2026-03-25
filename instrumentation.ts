import * as Sentry from "@sentry/nextjs";

import { shouldIgnoreError } from "./lib/monitoring/error";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = (...args: Parameters<typeof Sentry.captureRequestError>) => {
  const [error] = args;
  if (shouldIgnoreError(error)) {
    return;
  }
  Sentry.captureRequestError(...args);
};
