const { MongoClient } = require("mongodb");

class MongoConnection {
  constructor() {
    this.dbName = null;
    this.collection = null;
    this.client = null;
  }

  // mongodb+srv://HiuPOS:HiuSharkPOS@cluster0.iive8c8.mongodb.net/CORE_DB
  srv = `mongodb+srv://HiuPOS:HiuSharkPOS@cluster0.iive8c8.mongodb.net/${this.dbName}`;

  async connect() {
    if (this.client && this.isConnected()) {
      console.log("Reusing existing MongoDB connection");
      return this.client;
    }

    try {
      this.client = new MongoClient(this.srv, {});
      await this.client.connect();
      console.log("Created new MongoDB connection");
      return this.client;
    } catch (error) {
      console.error("Error connecting to MongoDB:", error);
      throw error;
    }
  }

  db(dbName) {
    if (!this.client) {
      throw new Error("No MongoDB client available. Please connect first.");
    }
    return this.client.db(dbName);
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      console.log("Closed MongoDB connection");
    }
  }

  async isConnected() {
    if (!this.client) {
      return false;
    }
    try {
      await this.client.db().command({ ping: 1 });
      return true;
    } catch (error) {
      console.error("Error checking MongoDB connection:", error);
      return false;
    }
  }
}

const mongoInstance = new MongoConnection();

module.exports = mongoInstance;
