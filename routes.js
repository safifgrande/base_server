const functionsConfig = require("./functions/config.json");
const authMiddleware = require("./engine/middleware/authMiddleware.js");

const pathExtractor = (path, func, method, useMiddleware, isApi) => {
  const getArgs = (req, res) => {
    return [req.body, res];
  };

  const handler = async (req, res) => {
    res.json(await func(...getArgs(req, res)));
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
    config.private,
  );
});

module.exports = { routes: [...funcRoutes] };
