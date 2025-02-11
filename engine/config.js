const path = require("path");
const fs = require("fs");
const BSON = require("bson");

const globalDir = path.join(__dirname, "/context");

// Dynamically require all function files and attach them to the global object
module.exports = () => {
  fs.readdirSync(globalDir).forEach((file) => {
    const functionPath = path.join(globalDir, file);

    if (path.extname(file) === ".js") {
      const functionName = path.basename(file, ".js");
      global[functionName] = require(functionPath);
    }
  });

  global.mongoInstance = require("./global/mongo");
  mongoInstance.connect();

  global.authMiddleware = require("./middleware/authMiddleware");

  const OriginalObjectId = BSON.ObjectId;

  BSON.ObjectId = function ObjectId(...args) {
    if (!(this instanceof ObjectId)) {
      return new OriginalObjectId(...args);
    }
    return new OriginalObjectId(...args);
  };

  BSON.ObjectId.prototype = OriginalObjectId.prototype;
  Object.setPrototypeOf(BSON.ObjectId, OriginalObjectId);

  global.BSON = BSON;
  global.EJSON = require("bson").EJSON;
};
