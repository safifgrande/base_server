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
    console.log(
      `*********************      ${this.path}      *********************`
    );
    if (this.request.user) console.log("User :", this.request.user?.name);
    console.log("Req Body :", this.request.body);
    console.log("Response :", body);
  }
}

module.exports = BridgeMiddleware;
