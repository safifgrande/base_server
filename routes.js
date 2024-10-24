const login = require("./api/v1/login");
const clientUser = require("./functions/clientUser");

const public_route = [
  {
    path: "/login",
    method: "post",
    handler: login,
  },
];

const protected_route = [
  {
    path: "/clientUser",
    middleware: authMiddleware,
    method: "post",
    handler: async (req, res) => {
      res.json({
        result: await clientUser(req.body),
      });
    },
  },
];

module.exports = { public_route, protected_route };
