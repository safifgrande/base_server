const Sentry = require("@sentry/node");

if (process.env.SENTRY_ENV) {
  Sentry.init({
    dsn: process.env.SENTRY_URL || "development",
    tracesSampleRate: 1.0,
  });
}
