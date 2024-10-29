class BridgeMiddleware {
  constructor() {
    this.request = null;
    this.response = null;
    this.path = null;
  }

  initiate(req, res, next) {
    this.request = req;
    this.response = res;
    this.path = req.path;

    // Intercept JSON
    const originalJson = res.json.bind(res);
    res.json = this.json.bind(this, originalJson);

    next();
  }

  json(originalJson, body) {
    this.logResponse(body);
    return originalJson(body);
  }

  logResponse(body) {
    logger.info(
      `${this.path}\n${
        this.request.user ? "User : " + this.request.user?.name : ""
      }\n${"Req Body : " + JSON.stringify(this.request.body, null, 2)}\n${
        "Response : " + JSON.stringify(body, null, 2)
      }\n`
    );
    // console.log(
    //   `*********************      ${this.path}      *********************`
    // );
    // if (this.request.user) console.log("User :", this.request.user?.name);
    // console.log("Req Body :", this.request.body);
    // console.log("Response :", JSON.stringify(body, null, 4));
  }
}

module.exports = BridgeMiddleware;
