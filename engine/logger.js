const pino = require("pino");
const pretty = require("pino-pretty");
const fs = require("fs");
const path = require("path");

const getDateString = () => {
  return new Date().getDate().toString().padStart(2, "0");
};

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// -------------- CONFIG
const configPath = path.join(process.cwd(), "logs/config.json");
let config;

const writeConfigDate = () => {
  config = {
    date: getDateString(),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
};

const emptyLogFiles = () => {
  const logFile = path.join(logsDir, `${getDateString()}.log`);
  if (fs.existsSync(logFile)) {
    fs.truncateSync(logFile, 0);
  }
};

if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  if (config.date !== getDateString()) {
    writeConfigDate();
    emptyLogFiles();
  }
} else {
  writeConfigDate();
}
// -------------- CONFIG

const prettyStream = pretty({
  colorize: true,
  translateTime: "SYS:standard",
  ignore: "pid,hostname",
});

const getLogStream = () => {
  const logFile = path.join(logsDir, `${getDateString()}.log`);
  return pretty({
    destination: fs.createWriteStream(logFile, { flags: "a" }),
    colorize: false,
    translateTime: "SYS:standard",
    ignore: "pid,hostname",
  });
};

const streams = [{ stream: prettyStream }, { stream: getLogStream() }];

module.exports = () => {
  global.logger = pino(
    {
      level: "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams)
  );
};
