module.exports = async (product_ids) => {
  try {
    const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
    const db = mongodb.db(context.values.get("DB_NAME"));
    const collectionNames = context.values.get("COLLECTION_NAMES");
    const { license } = context.functions.execute("intUserContext");

    if (!license) throw new Error("E30007BE");
    if (!product_ids) throw new Error("E20137BE");

    product_ids = product_ids.map((id) => BSON.ObjectId(id.toString()));

    return db
      .collection(collectionNames.product_package_item)
      .aggregate([
        {
          $match: {
            license,
          },
        },
        {
          $lookup: {
            from: "products",
            localField: "products",
            foreignField: "_id",
            as: "products",
          },
        },
        {
          $match: {
            products: {
              $elemMatch: {
                _id: {
                  $in: product_ids,
                },
              },
            },
          },
        },
        {
          $project: {
            name: 1,
            products: {
              _id: 1,
              active: 1,
            },
          },
        },
      ])
      .toArray();
  } catch (error) {
    return context.functions.execute(
      "handleCatchError",
      error,
      "",
      "intProductPartOfPackageItem"
    );
  }
};
