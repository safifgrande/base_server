const crypto = require("crypto");
const context = require("../engine/v1/context");

module.exports = function () {
  const hashPassword = (password) => {
    return crypto
      .createHmac("sha256", context.values.get("SECRET_PASSWORD_SALT"))
      .update(password)
      .digest("hex");
  };

  return Object.freeze({
    hashPassword,
  });
};
