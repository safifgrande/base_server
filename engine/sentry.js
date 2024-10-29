const Sentry = require("@sentry/node");

Sentry.init({
  dsn: "https://77b56635439772e5937fabf56f913232@sentry.mgc.pw/13",
  tracesSampleRate: 1.0,
});
