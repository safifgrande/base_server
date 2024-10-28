const fs = require("fs");
const path = require("path");
const axios = require("axios");

class context {
  constructor() {
    this.functions = {
      execute: this.#execute.bind(this),
    };
    this.services = {
      get: this.#services.bind(this),
    };
    this.values = {
      get: this.#values.bind(this),
    };
    this.http = {
      get: this.#http().get.bind(this),
      post: this.#http().post.bind(this),
    };
    this.user = {
      data: this.#user.bind(this),
    };
    this.environment = {
      ...this.#loadEnvironmentValues(),
    };
  }

  #user() {
    const data = {};

    return { data };
  }

  #http() {
    const post = async ({ url, headers, body, encodeBodyAsJSON = false }) => {
      try {
        // Set default headers if not provided
        const config = {
          headers: headers || {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        };

        const data = encodeBodyAsJSON ? JSON.stringify(body) : body;

        let response = await axios.post(url, data, config);
        response = {
          ...response,
          statusCode: response.status,
          body: {
            text: () => JSON.stringify(response.data),
          },
        };

        // Return the response data
        return response;
      } catch (error) {
        console.error("Error in context.http.post:", error);
        throw error;
      }
    };

    const get = async (url, options = {}) => {
      try {
        const response = await axios.get(`${url}`, options);
        return response.data;
      } catch (error) {
        console.error("Error in GET request:", error.message);
        throw error;
      }
    };

    return Object.freeze({ post, get });
  }

  #values(fileName) {
    const filePath = path.join(process.cwd(), "values", `${fileName}.json`);
    try {
      const fileContent = fs.readFileSync(filePath, "utf8");
      return JSON.parse(fileContent).value;
    } catch (error) {
      console.error(`Error reading file: ${filePath}`, error);
      return null;
    }
  }

  #services() {
    const mongoClient = mongoInstance.getConnection();

    const originalDbMethod = mongoClient.db.bind(mongoClient);

    mongoClient.db = (dbName) => {
      const dbInstance = originalDbMethod(dbName);

      // untuk intercept insertMany
      const originalCollectionMethod = dbInstance.collection.bind(dbInstance);
      dbInstance.collection = (collectionName) => {
        const collectionInstance = originalCollectionMethod(collectionName);

        const mongodbInsertMany =
          collectionInstance.insertMany.bind(collectionInstance);
        collectionInstance.insertMany = async (...param) => {
          const result = await mongodbInsertMany(...param);
          if (result.acknowledged) {
            return {
              insertedIds: Object.values(result.insertedIds).map((id) => id),
            };
          }

          return result;
        };

        return collectionInstance;
      };

      return dbInstance;
    };

    return mongoClient;
  }

  #execute(functionName, ...args) {
    const functionPath = path.join(
      process.cwd(),
      "functions",
      `${functionName}.js`
    );

    if (!fs.existsSync(functionPath)) {
      throw new Error(
        `Function file "${functionName}.js" not found in the functions directory.`
      );
    }

    try {
      const funcModule = require(functionPath); //await import(`file://${functionPath}`);
      const func = funcModule.default || funcModule;

      if (typeof func !== "function") {
        throw new Error(
          `File "${functionName}.js" does not export a valid function.`
        );
      }

      const result = func(...args);

      if (result instanceof Promise) {
        return result.then((resolvedResult) => resolvedResult);
      } else {
        return result;
      }
    } catch (error) {
      console.error(`Error executing function "${functionName}":`, error);
      throw error;
    }
  }

  #loadEnvironmentValues() {
    // TODO process env
    const tag = "development";
    const filePath = path.join(process.cwd(), "environments", `${tag}.json`);
    const envFile = require(filePath);
    return { tag, values: envFile?.values };
  }
}

/**
 * @type {{
 *   services: {
 *     get: () => import('mongodb').MongoClient
 *   }
 * }}
 */
const contextInstance = new context();

module.exports = contextInstance;
