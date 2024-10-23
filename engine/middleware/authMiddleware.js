const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    // Verify the token
    const decoded = jwt.verify(
      token,
      context.values.get("CUSTOM_JWT_PROVIDER")
    );

    // Attach the user from the token to the request
    context.user.data = {
      ...decoded.data,
    };

    // Continue to the next middleware or route handler
    next();
  } catch (err) {
    console.log(">>> ", err.message);
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = authMiddleware;
