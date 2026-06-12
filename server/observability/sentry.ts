import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.MUTLY_VERSION || "0.1.0",
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.05,
  });
}

export function captureException(err: Error, ctx?: Record<string, unknown>) {
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (ctx) scope.setContext("mutly", ctx);
    Sentry.captureException(err);
  });
}

export function setSentryContext(key: string, value: Record<string, unknown>) {
  Sentry.setContext(key, value);
}

export { Sentry };
