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

    const originalSend = res.send.bind(res);
    res.send = this.send.bind(this, originalSend);

    next();
  }

  send(originalSend, body) {
    console.log(
      `*********************      ${this.path}      *********************`
    );
    if (this.request.user) console.log("User :", this.request.user?.name);
    console.log("Req Body :", this.request.body);
    console.log("Response :", body);

    return originalSend(body);
  }
}

module.exports = BridgeMiddleware;
