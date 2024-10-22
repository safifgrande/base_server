const jwt = require("jsonwebtoken");
const context = require("../engine/v1/context");

module.exports = (payload) => {
  try {
    return generateJWT(payload);
  } catch (e) {
    throw new Error(e.message);
  }
};

const generateJWT = (payload) => {
  let { userData } = payload;

  const exp = new Date();
  exp.setFullYear(exp.getFullYear() + 1, exp.getMonth(), exp.getDay());

  return jwt.sign(
    {
      exp: Date.parse(exp),
      data: {
        name: userData.fullname,
        _id: userData._id,
        license: userData.license,
      },
    },
    context.values.get("CUSTOM_JWT_PROVIDER"),
    {
      algorithm: "HS256",
      header: {
        alg: "HS256",
        typ: "JWT",
      },
    }
  );
};
