exports = () => {
  try {
    const user_data = context.user.data;

    if (user_data.user_id) {
      return {
        _id: user_data.user_id.toString(),
        license: user_data.license
          ? BSON.ObjectId(user_data.license.toString())
          : undefined,
        name: user_data.name,
      };
    }
  } catch (error) {
    context.functions.execute("handleCatchError", error, "", "intUserContext");
  }

  return {};
};
