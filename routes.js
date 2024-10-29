const pathConfig = require("./functions/config.json");

const pathExtractor = (path, func, useMiddleware) => {
  const handler = async (req, res) => {
    res.json(await func(req.body));
  };

  const basicPath = {
    path: path,
    method: "post",
    handler,
  };

  if (useMiddleware) basicPath.middleware = authMiddleware;
  return basicPath;
};

const routes = pathConfig.map((config) => {
  if (config.private) {
    return pathExtractor(
      config.path,
      require(`./functions/${config.handler}`),
      config.private
    );
  }
  return {
    path: config.path,
    method: "post",
    handler: config.api
      ? require(`./api/${config.handler}`)
      : require(`./functions/${config.handler}`),
  };
});

module.exports = { routes };
