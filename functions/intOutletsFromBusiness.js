exports = async (business_id) => {
  try {
    const { license } = context.functions.execute("intUserContext");

    const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
    const db = mongodb.db(context.values.get("DB_NAME"));
    const { outlet } = context.values.get("COLLECTION_NAMES");

    const outlets = await db
      .collection(outlet)
      .aggregate([
        {
          $match: {
            license,
            business_id: BSON.ObjectId(business_id.toString()),
          },
        },
        {
          $project: { id: 1 },
        },
        {
          $group: {
            _id: null,
            outlets: { $push: "$_id" },
          },
        },
      ])
      .toArray();

    if (outlets.length == 0) return [];
    return outlets[0].outlets;
  } catch (error) {
    context.functions.execute(
      "handleCatchError",
      error,
      "",
      "intOutletsFromBusiness"
    );

    throw new Error(error.message);
  }
};
