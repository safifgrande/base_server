require("./engine/config")();
const express = require("express");
const { public_route, protected_route } = require("./routes");

const app = express();
const port = 3000;

app.use(express.json());

public_route.forEach(({ path, method, handler }) => {
  app[method](path, handler);
});

protected_route.forEach(({ path, method, middleware, handler }) => {
  app[method](path, middleware, handler);
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
