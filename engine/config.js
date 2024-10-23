const path = require("path");
const fs = require("fs");

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
  global.BSON = require("bson");
};
