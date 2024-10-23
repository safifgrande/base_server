module.exports = async function (payload) {
  try {
    const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
    const db = mongodb.db(context.values.get("DB_NAME"));
    const db_views = mongodb.db("VIEWS_DB");

    const { outlet, col_view, col_db } = payload;

    await db_views.collection(col_view).deleteMany({
      outlet_id: outlet,
    });

    const product_pipeline = [
      {
        $match: {
          active: true,
          group_active: true,
          department_active: true,
          // "license": ObjectId("66da9e786e1f32928cf8285f"),
          // "menu_variant": null,
          outlet,
        },
      },
      {
        $lookup: {
          from: "product_departments",
          let: {
            dp: "$product_department",
            license_id: "$license",
            outlet_id: "$outlet",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $eq: ["$license", "$$license_id"],
                    },
                    {
                      $eq: ["$outlet", "$$outlet_id"],
                    },
                    {
                      $eq: ["$_id", "$$dp"],
                    },
                  ],
                },
              },
            },
            {
              $lookup: {
                from: "product_groups",
                let: {
                  pd_group: "$product_group",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ["$license", "$$license_id"],
                          },
                          {
                            $eq: ["$outlet", "$$outlet_id"],
                          },
                          {
                            $eq: ["$_id", "$$pd_group"],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      name: 1,
                    },
                  },
                ],
                as: "product_group",
              },
            },
            {
              $unwind: "$product_group",
            },
            {
              $project: {
                _id: 1,
                name: 1,
                product_group: 1,
              },
            },
          ],
          as: "department",
        },
      },
      {
        $unwind: "$department",
      },
      {
        $addFields: {
          group: "$department.product_group",
        },
      },
      {
        $unset: "department.product_group",
      },
      {
        $lookup: {
          from: "product_prices",
          let: {
            license_id: "$license",
            outlet_id: "$outlet",
            prices: "$prices",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $eq: ["$license", "$$license_id"],
                    },
                    {
                      $eq: ["$outlet", "$$outlet_id"],
                    },
                    {
                      $in: ["$_id", "$$prices"],
                    },
                  ],
                },
              },
            },
            {
              $lookup: {
                from: "price_levels",
                let: {
                  price_level: "$price_level",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ["$license", "$$license_id"],
                          },
                          {
                            $eq: ["$outlet", "$$outlet_id"],
                          },
                          {
                            $eq: ["$_id", "$$price_level"],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      name: 1,
                      default: 1,
                    },
                  },
                ],
                as: "level",
              },
            },
            {
              $unwind: "$level",
            },
            {
              $project: {
                value: 1,
                default_price: "$level.default",
              },
            },
            {
              $match: {
                default_price: true,
              },
            },
            {
              $unset: "default_price",
            },
          ],
          as: "price",
        },
      },
      {
        $unwind: "$price",
      },
      {
        $lookup: {
          from: "outlet",
          localField: "outlet",
          foreignField: "_id",
          as: "outlet",
        },
      },
      {
        $unwind: "$outlet",
      },
      {
        $match: {
          "department.name": {
            $nin: ["custom", "package"],
          },
        },
      },
      {
        $project: {
          outlet_id: "$outlet._id",
          outlet_name: "$outlet.name",
          department_id: "$department._id",
          department_name: "$department.name",
          group_id: "$group._id",
          group_name: "$group.name",
          price: "$price.value",
          level: "$price.default_price",
          sku: 1,
          name: 1,
          active: 1,
          menu_variant: {
            $cond: {
              if: { $ifNull: ["$menu_variant", false] },
              then: true,
              else: false,
            },
          },
        },
      },
      {
        $merge: {
          into: {
            db: "VIEWS_DB",
            coll: "view_products",
          },
          on: "_id",
          whenMatched: "replace", // default: merge  (replace | keepExisting | fail)
          whenNotMatched: "insert", // default: insert (discard | fail)
        },
      },
    ];

    await db.collection(col_db).aggregate(product_pipeline).toArray();
  } catch (e) {
    context.functions.execute("handleCatchError", e, "", "intGenerateView");

    throw new Error(e.message);
  }
};
