const { setAuthUser } = require("../context/requestStorage");

const authMiddleware = (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    // Verify the token
    const decoded = utils.jwt.decode(
      token,
      context.values.get("CUSTOM_JWT_PROVIDER")
    );

    const userData = decoded?.payload?.data || {};
    const user = {
      ...userData,
      user_id: userData._id,
    };
    req.user = user;

    setAuthUser(user);

    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = authMiddleware;
