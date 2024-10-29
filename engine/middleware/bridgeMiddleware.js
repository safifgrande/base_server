class BridgeMiddleware {
  constructor() {
    this.request = null;
    this.response = null;
    this.path = null;
    this.startTime = null;
  }

  initiate(req, res, next) {
    this.request = req;
    this.response = res;
    this.path = req.path;
    this.startTime = process.hrtime();

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
    const [seconds, nanoseconds] = process.hrtime(this.startTime);
    const processingTimeMs = (seconds + nanoseconds / 1000000000).toFixed(3);

    const log = [
      "Processing Time : " + processingTimeMs + "s",
      "Path : " + this.path,
      this.request.user ? "User : " + this.request.user?.name : "",
      "Req Body : " + JSON.stringify(this.request.body, null, 2),
      "Response : " + JSON.stringify(body, null, 2),
    ];

    logger.info(`\n${log.join("\n")}\n`);
  }
}

module.exports = BridgeMiddleware;
