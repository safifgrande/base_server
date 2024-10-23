exports = () => {
  try {
    return {
      name: "BO",
      ...context.values.get("VERSION"),
    };
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      "",
      "webHooks_version"
    );
  }
};
