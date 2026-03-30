import * as Sentry from "@sentry/nextjs";

import {
  createSentryBeforeSend,
  getClientSentryDsn,
  getSentryEnvironment,
  isSentryEnabled,
} from "./lib/monitoring/error";

Sentry.init({
  dsn: getClientSentryDsn(),
  enabled: isSentryEnabled(),
  environment: getSentryEnvironment(),
  sendDefaultPii: false,
  beforeSend: createSentryBeforeSend(),
});
