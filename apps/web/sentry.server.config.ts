import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN_WEB ||
    process.env.NEXT_PUBLIC_SENTRY_DSN_WEB ||
    "https://413ab9842e07f8304383be819ab07705@o4507276057247744.ingest.us.sentry.io/4512357186404352",
  environment: process.env.NODE_ENV || "development",
  release: process.env.RSL_RELEASE || "rsl-marketing@1.0.0",
  tracesSampleRate: 1.0,
});
