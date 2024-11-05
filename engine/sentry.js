const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_URL || "development",
  tracesSampleRate: 1.0,
});
