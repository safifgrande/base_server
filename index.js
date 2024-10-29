require("./engine/config")();
require("./engine/logger")();
const express = require("express");
const BridgeMiddleware = require("./engine/middleware/bridgeMiddleware");
const { routes } = require("./routes");

const app = express();
const port = 3000;

app.use(express.json());

const bridge = new BridgeMiddleware();
app.use((req, res, next) => bridge.initiate(req, res, next));

// PUBLIC API
routes
  .filter((route) => !route.middleware)
  .forEach(({ path, method, handler }) => {
    app[method](path, handler);
  });

// PRIVATE API
routes
  .filter((route) => route.middleware)
  .forEach(({ path, method, middleware, handler }) => {
    app[method](path, middleware, handler);
  });

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
