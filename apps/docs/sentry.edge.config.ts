import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN_DOCS ||
    "https://bb3ed3d44a50d75126234d8bd8a4b0aa@o4507276057247744.ingest.us.sentry.io/4512357186928640",
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: 1.0,
});
