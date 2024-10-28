const login = require("./api/v1/login");
const clientUser = require("./functions/clientUser");
const clientPaymentMedia = require("./functions/clientPaymentMedia");
const adminEwallet = require("./functions/adminEwallet");
const clientBankAccount = require("./functions/clientBankAccount");
const clientBillDesign = require("./functions/clientBillDesign");
const clientBillingHistory = require("./functions/clientBillingHistory");
const adminRegisterClient = require("./functions/adminRegisterClient");
const clientEwallet = require("./functions/clientEwallet");

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
  pathExtractor("/adminEwallet", adminEwallet, true),
  pathExtractor("/clientBankAccount", clientBankAccount, true),
  pathExtractor("/clientBillDesign", clientBillDesign, true),
  pathExtractor("/clientBillingHistory", clientBillingHistory, true),
  pathExtractor("/adminRegisterClient", adminRegisterClient, true),
  pathExtractor("/clientEwallet", clientEwallet, true),
];

module.exports = { public_route, protected_route };
