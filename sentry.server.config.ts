import * as Sentry from "@sentry/nextjs";

import {
  createSentryBeforeSend,
  getSentryEnvironment,
  getServerSentryDsn,
  isSentryEnabled,
} from "./lib/monitoring/error";

Sentry.init({
  dsn: getServerSentryDsn(),
  enabled: isSentryEnabled(),
  environment: getSentryEnvironment(),
  sendDefaultPii: false,
  beforeSend: createSentryBeforeSend(),
});
