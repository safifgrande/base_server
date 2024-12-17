require("./engine/sentry");
require("./engine/config")();
require("./engine/logger")();
const express = require("express");
const cors = require("cors");
const BridgeMiddleware = require("./engine/middleware/bridgeMiddleware");
const { routes } = require("./routes");
const Sentry = require("@sentry/node");

const fs = require("fs");
const path = require("path");
const {
  requestStorageMiddleware,
  asyncLocalStorage,
} = require("./engine/context/requestStorage");
const modulesPath = path.join(__dirname, "http-api");

const app = express();
const port = process.env.PORT || 6000;

app.use(express.json());
app.use(cors());
app.use(requestStorageMiddleware);

const bridge = new BridgeMiddleware();
app.use((req, res, next) => bridge.initiate(req, res, next));
// API
fs.readdirSync(modulesPath).forEach((folder) => {
  const moduleRoutePath = path.join(modulesPath, folder, `${folder}.route.js`);

  if (fs.existsSync(moduleRoutePath)) {
    // Use the folder name as the base path for the module
    app.use(`/${folder}`, require(moduleRoutePath));
  }
});

// PUBLIC API
routes
  .filter((route) => !route.middleware)
  .forEach(({ path, method, handler }) => {
    app[method](path, (req, res) => {
      handler(req, res, app);
    });
  });

// PRIVATE API
routes
  .filter((route) => route.middleware)
  .forEach(({ path, method, middleware, handler }) => {
    app[method](path, middleware, (req, res) => {
      handler(req, res, app);
    });
  });

// NOTE harus diletakkan dibawah setelah semua routes
// dan sebelum error handler lain (jika ada)
Sentry.setupExpressErrorHandler(app);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
