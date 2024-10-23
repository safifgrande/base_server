module.exports = async (item_id) => {
  try {
    const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
    const db = mongodb.db(context.values.get("DB_NAME"));
    const collectionNames = context.values.get("COLLECTION_NAMES");
    const { license } = context.functions.execute("intUserContext");

    if (!license) throw new Error("E30007BE");
    if (!item_id) throw new Error("E20137BE");

    const item_in_promo_active = await db
      .collection(collectionNames.promo)
      .aggregate([
        {
          $match: {
            type: "buy_x_free_y",
            active: true,
            license,
          },
        },
        {
          $lookup: {
            from: "promo_reward",
            let: { rewards: "$rewards" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$rewards"] },
                },
              },
              {
                $lookup: {
                  from: "promo_option",
                  let: { options: "$options" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $in: ["$_id", "$$options"] },
                      },
                    },
                    {
                      $project: {
                        _id: 1,
                        object: 1,
                      },
                    },
                  ],
                  as: "options",
                },
              },
              {
                $project: {
                  _id: 1,
                  options: {
                    _id: 1,
                    object: 1,
                  },
                },
              },
            ],
            as: "rewards",
          },
        },
        {
          $lookup: {
            from: "products",
            let: { products_id: { $first: "$rewards.options.object" } },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", "$$products_id"] },
                },
              },
              {
                $lookup: {
                  from: "product_departments",
                  let: { product_department: "$product_department" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$product_department"] },
                      },
                    },
                    {
                      $project: {
                        _id: 1,
                        product_group: 1,
                      },
                    },
                  ],
                  as: "department",
                },
              },
              {
                $project: {
                  _id: 1,
                  department: {
                    _id: 1,
                    product_group: 1,
                  },
                },
              },
              {
                $addFields: {
                  group_id: { $first: "$department.product_group" },
                },
              },
            ],
            as: "products",
          },
        },
        {
          $addFields: {
            all_id: {
              $concatArrays: [
                "$products._id",
                "$products.product_department",
                "$products.group_id",
              ],
            },
          },
        },
        {
          $addFields: {
            item_in_promo_active: {
              $in: [BSON.ObjectId(item_id.toString()), "$all_id"],
            },
          },
        },
        {
          $project: {
            _id: 0,
            item_in_promo_active: 1,
          },
        },
      ])
      .toArray();

    return JSON.stringify(item_in_promo_active).includes("true");
  } catch (error) {
    context.functions.execute(
      "handleCatchError",
      error,
      "",
      "intProductAvaibility"
    );

    throw new Error(error.message);
  }
};
