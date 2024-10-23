exports = async (payload) => {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  const valid = context.functions.execute("intValidation");

  try {
    const newPassword = valid.hashPassword(payload.data.newPassword);

    await updatePassword(db, collectionNames, user, newPassword);

    return {
      status: true,
      message: "success",
      data: null,
      error: null,
    };
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientChangePassword"
    );
  }
};

const getUserData = async (db, user) => {
  return db.collection("user").findOne(
    {
      _id: BSON.ObjectId(user._id.toString()),
      license: BSON.ObjectId(user.license.toString()),
    },
    { _id: 1, password: 1 }
  );
};

const updatePassword = async (db, collectionNames, user, newPassword) => {
  const dataUpdate = {
    password: newPassword,
    updatedAt: new Date(),
    updatedBy: BSON.ObjectId(user._id),
  };

  return db.collection(collectionNames.user).updateOne(
    {
      _id: BSON.ObjectId(user._id.toString()),
      license: BSON.ObjectId(user.license.toString()),
    },
    {
      $set: { ...dataUpdate },
      $inc: { __v: 1 },
    }
  );
};
