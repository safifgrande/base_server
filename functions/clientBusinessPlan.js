module.exports = async (payload) => {
  try {
    const businessPlan = generalFunction(payload);

    const { method } = payload;
    if (businessPlan[method]) {
      return await businessPlan[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientBusinessPlan"
    );
  }
};

const generalFunction = (payload) => {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { master_license, outlet } = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  // exports({
  //   method: 'LIST',
  //   filter: {},
  //   data: {},
  // })

  const LIST = async () => {
    await listValidationAndFilter();
    const business_plan = await getBusinessPlan();
    return listReturnFormat(business_plan);
  };

  const listReturnFormat = (business_plan) => {
    return business_plan.map((plan) => {
      plan.id = plan._id.toString();
      plan.ppn_label = `PPN ${plan.price_level.tax}%`;
      plan.total = plan.price_level.price;
      plan.ppn_rate = plan.price_level.tax;
      plan.value = Number(
        (plan.price_level.price / (plan.price_level.tax / 100 + 1)).toFixed(2)
      );
      plan.ppn_value = Number((plan.total - plan.value).toFixed(2));

      delete plan.price_level;
      delete plan._id;
      return plan;
    });
  };

  const getBusinessPlan = async () => {
    const { filter } = payload;

    return db
      .collection(master_license)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: "master_license_price_level",
            let: { priceLevel: "$priceLevel" },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", "$$priceLevel"] },
                  default: true,
                },
              },
              {
                $project: {
                  price: 1,
                  tax: 1,
                },
              },
            ],
            as: "price_level",
          },
        },
        {
          $unwind: "$price_level",
        },
        {
          $project: {
            name: 1,
            price_level: {
              price: 1,
              tax: 1,
            },
          },
        },
      ])
      .toArray();
  };

  const getCountryId = async () => {
    // diubah dari query user_license ke outlet karena user_license untuk karyawan (user bukan owner) tidak memiliki user_license
    const userOutlet = await db.collection(outlet).findOne(
      {
        license: BSON.ObjectId(user.license.toString()),
      },
      {
        country: 1,
      }
    );

    return userOutlet.country;
  };

  const listValidationAndFilter = async () => {
    let { filter } = payload;

    filter.country_id = await getCountryId();
    filter.default = false;
    filter.display = true;
    filter.active = true;
  };

  return Object.freeze({ LIST });
};
