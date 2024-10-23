module.exports = async (payload) => {
  try {
    const promoObject = generalFunction(payload);

    const { method } = payload;
    if (promoObject[method]) {
      return await promoObject[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientPromo"
    );
  }
};

const generalFunction = (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const {
    promo: promo_collection,
    promo_option,
    promo_reward,
    promo_term,
  } = context.values.get("COLLECTION_NAMES");

  const { license, _id: user_id } = context.functions.execute("intUserContext");

  const GET_TYPE = () => {
    return context.values.get("PROMO_TYPES");
  };

  /*
    exports({
      method: 'ACTIVE',
      filter: {
        id: '61d66271bf54105cb0309a6b',
      },
      data: {
        active: false,
      }
    })
  */

  const ACTIVE = async () => {
    await activeValidation();

    const findPromo = await updateActivePromo();

    if (!findPromo) {
      throw new Error("E20092BE");
    }

    return findPromo._id.toString();
  };

  const updateActivePromo = async () => {
    const { data, filter } = payload;

    const dataUpdate = {
      active: data.active,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),
    };

    return db.collection(promo_collection).findOneAndUpdate(
      {
        ...filter,
      },
      {
        $set: { ...dataUpdate },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1 },
      }
    );
  };

  const activeValidation = async () => {
    await valid.hasPermission(["bo_promo"]);

    const { data, filter } = payload;

    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(filter, "id", "E20106BE", true);

    filter._id = BSON.ObjectId(filter.id.toString());
    filter.license = license;
    delete filter.id;

    if (payload.data.active) {
      await validationItemsIsNonactive(filter._id);
    }
  };

  /*
    exports({
      method: 'GET',
      filter: {
        id: '61d66271bf54105cb0309a6b',
      }
    })
  */
  const GET = async () => {
    await getValidation();

    const detail_promo = await getPromoData();

    return formatDetailData(detail_promo);
  };

  const getPromoData = async () => {
    const optionQuery = {
      $lookup: {
        from: "promo_option",
        let: {
          options: { $ifNull: ["$options", []] },
        },
        pipeline: [
          { $match: { $expr: { $in: ["$_id", "$$options"] } } },
          {
            $lookup: {
              from: "products",
              let: {
                product: "$object",
              },
              pipeline: [
                { $match: { _id: "$$product" } },
                {
                  $project: {
                    _id: 0,
                    id: { $toString: "$_id" },
                    name: 1,
                    sku: 1,
                  },
                },
              ],
              as: "product",
            },
          },
          {
            $unwind: {
              path: "$product",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "product_departments",
              let: {
                department: "$object",
              },
              pipeline: [
                { $match: { _id: "$$department" } },
                {
                  $lookup: {
                    from: "products",
                    localField: "_id",
                    foreignField: "product_department",
                    as: "products",
                  },
                },
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    products: { $size: "$products" },
                  },
                },
                {
                  $group: {
                    _id: "$_id",
                    id: { $first: { $toString: "$_id" } },
                    name: { $first: "$name" },
                    total_product: { $sum: "$products" },
                  },
                },
                {
                  $project: {
                    _id: 0,
                  },
                },
              ],
              as: "department",
            },
          },
          {
            $unwind: {
              path: "$department",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "product_groups",
              let: {
                group: "$object",
              },
              pipeline: [
                { $match: { _id: "$$group" } },
                {
                  $lookup: {
                    from: "product_departments",
                    localField: "_id",
                    foreignField: "product_group",
                    as: "departments",
                  },
                },
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    departments: { $size: "$departments" },
                  },
                },
                {
                  $group: {
                    _id: "$_id",
                    id: { $first: { $toString: "$_id" } },
                    name: { $first: "$name" },
                    total_department: { $sum: "$departments" },
                  },
                },
                {
                  $project: {
                    _id: 0,
                  },
                },
              ],
              as: "group",
            },
          },
          {
            $unwind: {
              path: "$group",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 0,
              type: 1,
              product: 1,
              department: 1,
              group: 1,
              qty: 1,
            },
          },
        ],
        as: "options",
      },
    };

    const detail_promo = await db
      .collection(promo_collection)
      .aggregate([
        {
          $match: {
            _id: payload.filter._id,
            license,
          },
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
          $lookup: {
            from: "user_business",
            localField: "outlet.business_id",
            foreignField: "_id",
            as: "business",
          },
        },
        {
          $unwind: {
            path: "$business",
          },
        },
        {
          $lookup: {
            from: "promo_term",
            let: { term: "$terms" },
            pipeline: [
              { $match: { _id: "$$term" } },
              optionQuery,
              {
                $project: {
                  _id: 0,
                  value: 1,
                  category: 1,
                  options: 1,
                  logic: 1,
                },
              },
            ],
            as: "terms",
          },
        },
        {
          $unwind: "$terms",
        },
        {
          $lookup: {
            from: "promo_reward",
            let: { reward: "$rewards" },
            pipeline: [
              { $match: { _id: "$$reward" } },
              optionQuery,
              {
                $lookup: {
                  from: "price_levels",
                  localField: "price_level",
                  foreignField: "_id",
                  as: "price_level",
                },
              },
              {
                $unwind: {
                  path: "$price_level",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $project: {
                  _id: 0,
                  value: 1,
                  value_type: 1,
                  category: 1,
                  logic: 1,
                  price_level: {
                    _id: 1,
                    name: 1,
                  },
                  options: 1,
                },
              },
            ],
            as: "rewards",
          },
        },
        {
          $unwind: "$rewards",
        },
        {
          $project: {
            _id: 0,
            id: { $toString: "$_id" },
            outlet_id: { $toString: "$outlet._id" },
            outlet_name: "$outlet.name",
            business_id: { $toString: "$business._id" },
            business_name: "$business.name",
            active: 1,
            type: 1,
            name: 1,
            automatic: 1,
            multiply: 1,
            repeat: 1,
            repeat_date: 1,
            start_date: 1,
            end_date: 1,
            days: 1,
            hours: 1,
            memo: 1,
            priority: 1,
            terms: 1,
            rewards: 1,
          },
        },
      ])
      .toArray();

    if (detail_promo.length == 0) {
      throw new Error("E20092BE");
    }

    return detail_promo[0];
  };

  const getTermLogicAndProducts = (v) => {
    v.term_logic = "";
    v.term_products = [];
    if (v.terms.options.length > 0) {
      v.term_logic = v.terms.logic ? v.terms.logic : "";
      v.term_products =
        v.terms.options.reduce((prev, option) => {
          let optionReturn;
          if (option.type == "product") {
            optionReturn = { sku: option.product.sku };
          } else if (option.type == "department") {
            optionReturn = {
              total_product: option.department.total_product,
            };
            // inspect ulang group apakah masih digunakan ?
          } else if (option.type === "group") {
            optionReturn = {
              total_department: option.group.total_department,
            };
          }

          return [
            ...prev,
            {
              id: option[option.type].id.toString(),
              name: option[option.type].name,
              qty: option.qty ? option.qty : 0,
              ...optionReturn,
            },
          ];
        }, []) || [];

      v.term_product_type = "";
      if (v.terms.options[0].type) {
        v.term_product_type = v.terms.options[0].type;
      }
    }

    return v;
  };

  const getRewardLogicAndProducts = (v) => {
    v.reward_logic = "";
    v.reward_products = [];
    v.reward_product_type = "";
    if (v.rewards.options.length > 0) {
      v.reward_logic = v.rewards.logic;
      v.reward_products =
        v.rewards.options.reduce((prev, option) => {
          let optionReturn;
          if (option.type == "product") {
            optionReturn = { sku: option.product.sku };
          } else if (option.type == "department") {
            optionReturn = {
              total_product: option.department.total_product,
            };
          } else if (option.type == "group") {
            optionReturn = {
              total_department: option.group.total_department,
            };
          }

          return [
            ...prev,
            {
              id: option[option.type].id.toString(),
              name: option[option.type].name,
              qty: option.qty ? option.qty : 0,
              ...optionReturn,
            },
          ];
        }, []) || [];

      if (v.rewards.options[0].type) {
        v.reward_product_type = v.rewards.options[0].type;
      }
    }
    return v;
  };

  const formatDetailData = (v) => {
    v = getTermLogicAndProducts(v);
    v = getRewardLogicAndProducts(v);

    v.term_promo_type = v.terms?.category ? v.terms.category : "";
    v.term_value = v.terms?.value ? v.terms.value : 0;
    v.reward_type = v.rewards?.value_type ? v.rewards.value_type : "";
    v.reward_value = v.rewards?.value ? v.rewards.value : 0;
    v.reward_price_level_id = v.rewards?.price_level
      ? v.rewards.price_level._id.toString()
      : "";
    v.reward_price_level_name = v.rewards?.price_level_name
      ? v.rewards.price_level_name
      : "";

    v.reward_category = "";
    if (v.rewards?.category) {
      if (v.rewards.category == "amount") {
        v.reward_category = "nominal";
      } else {
        v.reward_category = v.rewards.category;
      }
    }

    delete v.terms;
    delete v.rewards;
    return v;
  };

  const getValidation = async () => {
    if (!(await valid.hasPermission(["bo_promo"], false))) {
      return [];
    }

    if (!payload.filter.id) throw new Error("E20092BE");
    payload.filter._id = BSON.ObjectId(payload.filter.id.toString());
    delete payload.filter.id;
  };

  /*
  exports({
      method: 'LIST',
      filter: {
        business_id: "61d661a77094bafa2e87c2ed",
        outlet_id: "61d661a77094bafa2e87c2ec",
        active: true,
      }
    })
  */

  const LIST = async () => {
    await listValidation();

    return getListPromo();
  };

  /*
    exports(
    {
      method: 'POST',
      filter: {},
      data: {
          id: '',
          outlet_id: '6204dbbda15ddca380997b3c', //required
          type: 'min_qty', //required
          name: 'minimal trans ffuuuckkk ', //
          automatic: true,
          multiply: true,
          repeat: false,
          repeat_date: '',
          start_date: '',
          end_date: '',
          days:[],   // ['0', '1']
          hours: [], // ['10:00-11:00']
          memo: '',

          // buy_x_free_y
          // term_product_type: 'product', // product||department
          // term_products_qty: 0, // promo term
          // term_products: [{'id':'62061bca3dcbe11103c1d156', 'qty': 1}], // masukan qty ke value
          // term_logic: "or",
          // reward_product_type: 'product', // product||department
          // reward_products_qty: 0,
          // reward_products: [{'id':'62061bcbdb01571b34eb25da','qty':1}], // masukan qty ke value
          // reward_logic: "or",
          // reward_target: "item"

          // buy_x_pay_y
          // term_logic: "or",
          // term_product_type: 'product', //
          // term_products_qty: 5,
          // term_products: [{'id':'61fcc59280ff84f3614eafe7', 'qty': 13}],
          // reward_type: 'amount', // amount | percentage
          // reward_category: 'quantity',
          // reward_value: 10,

          // // free_item
          // term_value: 2,
          // term_product_type: 'product',
          // term_products: [{'id':'61fcc59280ff84f3614eafe7', 'qty': 3}],
          // reward_value: 1,

          // multi_price
          // reward_price_level_id: '61c2b0e47094bafa2e9bdf19', // price_level id
          // term_product_type: 'product',
          // term_products: [{'id':'61fcc59280ff84f3614eafe7', 'qty': 3}],

          // min_trans
          // term_value: 100000,
          // reward_value: 10,
          // reward_type: 'percentage', // amount | percentage

          // min_qty
          // term_value: 5,
          // reward_value: 25000,
          // reward_type: 'amount', // amount | percentage
          // term_product_type: 'product',
          // term_products: [{'id':'61fcc59280ff84f3614eafe7', 'qty': 3}],
          // term_logic:"or"
        }
      }
    )

    1. validation
    2. build data to save
    3. insert or update promo
  */
  const POST = async () => {
    // 1. validation
    await postValidation();

    // 2. build data to save
    const promo = await context.functions.execute(
      "intPromoPostHandle",
      payload
    );

    // 3. insert or update promo
    return insertPromo(promo);
  };

  const insertPromo = async (promo) => {
    const { data } = payload;

    if (data._id) {
      return updatePromo(promo);
    } else {
      return createPromo(promo);
    }
  };

  const updatePromo = async (promo) => {
    if (promo.options.length > 0) {
      await updateOption(promo.options);
    }

    await db
      .collection(promo_reward)
      .updateOne({ _id: promo.rewards._id, license }, { $set: promo.rewards });

    await db
      .collection(promo_term)
      .updateOne({ _id: promo.terms._id, license }, { $set: promo.terms });

    const promoUpdateParams = postUnsetPromo(promo.promo_data);

    await db
      .collection(promo_collection)
      .updateOne({ _id: promo.promo_data._id, license }, promoUpdateParams);

    return promo.promo_data._id.toString();
  };

  const updateOption = async (options) => {
    const optionQuery = options.map((option) => {
      return {
        updateOne: {
          filter: {
            _id: option._id,
            license,
          },
          update: {
            $set: {
              ...option,
            },
          },
          upsert: true,
        },
      };
    });

    await db.collection(promo_option).bulkWrite(optionQuery);
  };

  const createPromo = async (promo) => {
    if (promo.options.length > 0) {
      await db.collection(promo_option).insertMany(promo.options);
    }
    await db.collection(promo_reward).insertOne(promo.rewards);
    await db.collection(promo_term).insertOne(promo.terms);

    // handle khusus untuk membersihkan data null
    removeNullData(promo.promo_data);
    await db.collection(promo_collection).insertOne(promo.promo_data);

    return promo.promo_data._id.toString();
  };

  // saat construct data di RF `clientPromoPostHandle`
  // sengaja value-nya di beri null
  // agar saat update bisa di lakukan proses `unset`
  // tapi untuk proses insert, harus di hapus
  const removeNullData = (promo_data) => {
    if (!promo_data.start_date) delete promo_data.start_date;
    if (!promo_data.end_date) delete promo_data.end_date;
    if (!promo_data.repeat_date) delete promo_data.repeat_date;
  };

  // saat proses update, data yang null akan di hapus (unset) dari collection
  // saat ini data yang di unset masih hardcode, belum ada kebutuhan dynamic unset
  const postUnsetPromo = (promo_data) => {
    const unsetData = {};
    if (!promo_data.start_date) {
      unsetData["start_date"] = "";
      delete promo_data.start_date;
    }
    if (!promo_data.end_date) {
      unsetData["end_date"] = "";
      delete promo_data.end_date;
    }
    if (!promo_data.repeat_date) {
      unsetData["repeat_date"] = "";
      delete promo_data.repeat_date;
    }

    const promoUnset = { $set: promo_data };

    if (Object.keys(unsetData).length > 0) {
      promoUnset["$unset"] = unsetData;
    }

    return promoUnset;
  };

  const postValidation = async () => {
    const { data } = payload;

    await valid.hasPermission(["bo_promo"]);

    valid.isObjValid(data, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "type", "E20169BE", true);
    valid.isObjValid(data, "name", "E20170BE", true);

    await valid.isUnique(payload.data, promo_collection, "name", "E30095BE");

    if (data.id) {
      data._id = BSON.ObjectId(data.id);
    }
    delete data.id;

    if (data._id && payload.data.active) {
      await validationItemsIsNonactive(data._id);
    }

    data.outlet = BSON.ObjectId(data.outlet_id);
    delete data.outlet_id;

    dateValidation();
  };

  const dateIsValid = (date) => {
    date = new Date(date);

    return date instanceof Date && !isNaN(date);
  };

  const dateValidation = () => {
    const { data } = payload;

    if (
      (data.start_date && !dateIsValid(data.start_date)) ||
      (data.end_date && !dateIsValid(data.end_date))
    ) {
      throw new Error("E20021BE");
    }

    if (
      data.start_date &&
      data.end_date &&
      new Date(data.start_date) > new Date(data.end_date)
    ) {
      throw new Error("E20022BE");
    }
  };

  const getListPromo = async () => {
    return db
      .collection(promo_collection)
      .aggregate([
        { $match: payload.filter },
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
          $group: {
            _id: "$_id",
            id: { $first: { $toString: "$_id" } },
            name: { $first: "$name" },
            active: { $first: "$active" },
            automatic: { $first: "$automatic" },
            multiply: { $first: "$multiply" },
            priority: { $first: "$priority" },
            outlet_name: { $first: "$outlet.name" },
            outlet_id: { $first: { $toString: "$outlet._id" } },
            createdAt: { $first: "$createdAt" },
          },
        },
        {
          $project: {
            _id: 0,
          },
        },
        {
          $sort: { createdAt: -1 },
        },
      ])
      .toArray();
  };

  const listValidation = async () => {
    const { filter } = payload;

    if (!(await valid.hasPermission(["bo_promo"], false))) {
      return [];
    }

    valid.isRequired(payload, "filter", "E20037BE");
    valid.isRequired(filter, "business_id", "E20110BE");

    let outlet_in_bussiness = await context.functions.execute(
      "intOutletsFromBusiness",
      filter.business_id
    );
    delete filter.business_id;

    if (filter.outlet_id) {
      const outletId = outlet_in_bussiness.find(
        (v) => v.toString() == filter.outlet_id.toString()
      );

      if (!outletId) throw new Error("E30032BE");

      filter.outlet = BSON.ObjectId(outletId.toString());
    } else {
      filter.outlet = { $in: outlet_in_bussiness };
    }
    delete filter.outlet_id;
    filter.license = license;
  };

  // validasi items ada yang nonactive atau tidak
  const validationItemsIsNonactive = async (promoId) => {
    const itemIsNonactive = await dbValidationItemsIsNonactive(promoId);

    if (itemIsNonactive[0]?.items_is_nonactive) throw new Error("E30117BE");
  };

  const dbValidationItemsIsNonactive = async (promoId) => {
    return db
      .collection(promo_collection)
      .aggregate([
        {
          $match: { _id: promoId, license },
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
                  let: { options: { $ifNull: ["$options", []] } },
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
        { $addFields: { products_id: { $first: "$rewards.options.object" } } },
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
                      $lookup: {
                        from: "product_groups",
                        let: { product_group: "$product_group" },
                        pipeline: [
                          {
                            $match: {
                              $expr: { $eq: ["$_id", "$$product_group"] },
                            },
                          },
                          {
                            $project: {
                              _id: 1,
                              active: 1,
                            },
                          },
                        ],
                        as: "group",
                      },
                    },
                    {
                      $addFields: {
                        status_group: { $first: "$group.active" },
                      },
                    },
                    {
                      $project: {
                        _id: 1,
                        active: 1,
                        status_group: 1,
                      },
                    },
                  ],
                  as: "department",
                },
              },
              {
                $addFields: {
                  department_active: { $first: "$department.active" },
                  group_active: { $first: "$department.status_group" },
                },
              },
            ],
            as: "products",
          },
        },
        {
          $addFields: {
            status_active: {
              $concatArrays: [
                "$products.active",
                "$products.department_active",
                "$products.group_active",
              ],
            },
          },
        },
        {
          $addFields: {
            items_is_nonactive: { $in: [false, "$status_active"] },
          },
        },
        {
          $project: {
            _id: 0,
            items_is_nonactive: 1,
          },
        },
      ])
      .toArray();
  };

  return Object.freeze({ POST, ACTIVE, GET, LIST, GET_TYPE });
};
