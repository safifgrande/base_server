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

    const userData = decoded?.payload?.data;
    context.user.data = {
      ...userData,
      user_id: userData._id,
    };

    // Continue to the next middleware or route handler
    next();
  } catch (err) {
    console.log(">>> ", err.message);
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = authMiddleware;
