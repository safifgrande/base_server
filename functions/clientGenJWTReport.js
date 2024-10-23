module.exports = async (payload) => {
  try {
    const reportJWT = generalFunction(payload);

    const { method } = payload;
    if (reportJWT[method]) {
      return await reportJWT[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientGenJWTReport"
    );
  }
};

const generalFunction = (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { user } = context.values.get("COLLECTION_NAMES");

  const { license, _id: user_id } = context.functions.execute("intUserContext");

  const GET = async () => {
    const userdata = await getUser();

    return context.functions.execute("intGenerateCustomJwt", {
      app_id: context.environment.values.REPORT_REALM_APP_ID,
      userData: userdata,
    });
  };

  const getUser = async () => {
    return db
      .collection(user)
      .findOne(
        { _id: BSON.ObjectId(user_id), license },
        { _id: 1, fulllname: 1, license: 1 }
      );
  };

  return Object.freeze({ GET });
};
