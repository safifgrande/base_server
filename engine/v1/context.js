const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoInstance = require("../global/mongo");

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
  }

  #user() {
    const data = {};

    return { data };
  }

  #http() {
    const post = async (url, data, options = {}) => {
      try {
        const response = await axios.post(`${url}`, data, options);
        return response.data;
      } catch (error) {
        console.error("Error in POST request:", error.message);
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
    return mongoInstance.getConnection();
  }

  async #execute(functionName, ...args) {
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
      const funcModule = await import(`file://${functionPath}`);
      const func = funcModule.default || funcModule;

      if (typeof func !== "function") {
        throw new Error(
          `File "${functionName}.js" does not export a valid function.`
        );
      }

      const result = await func(...args);
      return result;
    } catch (error) {
      console.error(`Error executing function "${functionName}":`, error);
      throw error;
    }
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
