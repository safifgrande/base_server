const login = require("./api/v1/login");
const clientUser = require("./functions/clientUser");
const clientPaymentMedia = require("./functions/clientPaymentMedia");

const pathExtractor = (path, func, useMiddleware) => {
  const handler = async (req, res) => {
    res.json({
      result: await func(req.body),
    });
  };

  const basicPath = {
    path: path,
    method: "post",
    handler,
  };

  if (useMiddleware) basicPath.middleware = authMiddleware;
  return basicPath;
};

const public_route = [
  {
    path: "/login",
    method: "post",
    handler: login,
  },
];

const protected_route = [
  pathExtractor("/clientUser", clientUser, true),
  pathExtractor("/clientPaymentMedia", clientPaymentMedia, true),
];

module.exports = { public_route, protected_route };
