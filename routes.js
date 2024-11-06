const functionsConfig = require("./functions/config.json");
const apiConfig = require("./api/config.json");

const pathExtractor = (path, func, method, useMiddleware) => {
  const handler = async (req, res) => {
    res.json(await func(req.body));
  };

  const basicPath = {
    path: path,
    method: method || "post",
    handler,
  };

  if (useMiddleware) basicPath.middleware = authMiddleware;
  return basicPath;
};

const funcRoutes = functionsConfig.map((config) => {
  return pathExtractor(
    config.path,
    require(`./functions/${config.handler}`),
    config.method,
    config.private
  );
});

const apiRoutes = apiConfig.map((config) => {
  return pathExtractor(
    config.path,
    require(`./api/${config.handler}`),
    config.method,
    config.private
  );
});

module.exports = { routes: [...funcRoutes, ...apiRoutes] };
