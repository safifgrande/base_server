const login = require("./api/v1/login");

const public_route = [
  {
    path: "/login",
    method: "post",
    handler: login,
  },
];

const protected_route = [
  {
    path: "/data",
    middleware: authMiddleware,
    method: "get",
    handler: async (req, res) => {
      res.send(
        await context.http.get("https://jsonplaceholder.typicode.com/todos/")
      );
    },
  },
  {
    path: "/get_user",
    middleware: authMiddleware,
    method: "get",
    handler: async (req, res) => {
      res.send({ data: context.user.data });
    },
  },
];

module.exports = { public_route, protected_route };
