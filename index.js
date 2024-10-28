require("./engine/config")();
const express = require("express");
const { public_route, protected_route } = require("./routes");
const BridgeMiddleware = require("./engine/middleware/bridgeMiddleware");

const app = express();
const port = 3000;

app.use(express.json());

const bridge = new BridgeMiddleware();
app.use((req, res, next) => bridge.initiate(req, res, next));

public_route.forEach(({ path, method, handler }) => {
  app[method](path, handler);
});

protected_route.forEach(({ path, method, middleware, handler }) => {
  app[method](path, middleware, handler);
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
