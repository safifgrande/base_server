module.exports = function (payload) {
  try {
    const { filter } = payload;
    let val;
    let data;

    if (!filter) return {};

    if (typeof filter === "string") {
      val = "CLIENT_ENV_" + filter;
    }

    if (typeof filter === "object") {
      return filter.reduce((prev, curr) => {
        val = "CLIENT_ENV_" + curr;
        env = context.environment.values[val];

        if (typeof env === "string") {
          env = JSON.parse(env);
        } else {
          env = {};
        }

        return { ...prev, ...env };
      }, {});
    }

    data = context.environment.values[val];
    if (!data) return {};

    return JSON.parse(data);
  } catch (err) {
    context.functions.execute("handleCatchError", err, "", "clientGetEnv");
    throw new Error(err.message);
  }
};
