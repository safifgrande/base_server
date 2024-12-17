const express = require("express");
const cors = require("cors");
const vm = require('node:vm');

const app = express();
const port = process.env.PORT || 6000;

app.use(express.json());
app.use(cors());

const functionsConfig = require("./functions/config.json");
const { readFileSync } = require('node:fs');
const funcRoutes = functionsConfig.map((config) => {
  return {
    ...config,
    method: config.method || "post",
    funcString: readFileSync(`./functions/${config.handler}.js`),
  };
});

funcRoutes
  .forEach(({ path, method, funcString }) => {
    console.log(`${path} : ${method.toUpperCase()}`);
    app[method](path, async (req, res) => {
      res.json(await reqProcess(req, funcString));
    });
  });


app.listen(port, () => {
  console.log(`\n\nApp listening on port ${port}`);
});


async function reqProcess(req, funcString) {
  let response = {};
  try {
    const context = buildContext(req);
    const payload = buildPayload(req);
    response = await vmProcess(funcString, context, payload);

  } catch (err) {
    console.log(err, ">>>>>> ", path);
    return err.message;
  }
  finally {
    return response;
  }
}

function buildContext(req) {
  return {
    setTimeout,
    console,
    context: {
      user: {
        data: {
          user_id: req.url
        }
      },
    },
    EJSON: {
      parse: (...args) => JSON.parse(...args)
    },
    BSON: {
      binary: {
        fromText: (...args) => Buffer.from(...args)
      }
    }
  };
}

function buildPayload(req) {
  return {
    body: {
      text: () => {
        return JSON.stringify(req.body);
      }
    }
  };
}

async function vmProcess(funcString, context, payload) {
  const script = new vm.Script(funcString);
  vm.createContext(context);
  const vmResult = await script.runInContext(context);

  return vmResult(payload);
}

