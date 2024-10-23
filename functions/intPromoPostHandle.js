module.exports = async (payload) => {
  try {
    const dataHandle = promoPostHandle(payload);

    const buildData = await dataHandle.buildDataToSave();

    return buildData;
  } catch (e) {
    context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "intPromoPostHandle"
    );

    throw new Error(e.message);
  }
};

const promoPostHandle = (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));

  const promo_types = context.values.get("PROMO_TYPES").reduce((prev, pt) => {
    return { ...prev, [pt.value]: pt.value };
  }, {});

  const { license, _id: user_id } = context.functions.execute("intUserContext");
  const {
    promo: promo_collection,
    promo_option,
    products: products_collection,
  } = context.values.get("COLLECTION_NAMES");

  const validationByType = async () => {
    const { data } = payload;

    switch (data.type) {
      case promo_types.buy_x_free_y:
        productQtyValidation(true, true);
        break;
      case promo_types.buy_x_pay_y:
        xpayyValidation();
        break;
      case promo_types.free_item:
        freeValidation();
        break;
      case promo_types.multi_price:
        await multiPriceValidation();
        break;
      case promo_types.min_trans:
        minTransValidation();
        break;
      case promo_types.min_qty:
        minQyValidation();
        break;
      default:
        break;
    }
  };

  const buildDataToSave = async () => {
    const { data } = payload;

    await validationByType();

    let oldData = null;
    if (data._id) {
      oldData = await getOldPromo();
      typePromoValidation(oldData);
    }

    const term_options = await buildOptionsData("term", oldData);
    const terms = buildTermData(term_options, oldData);
    const reward_options = await buildOptionsData("reward", oldData);
    const rewards = buildRewardData(reward_options, oldData);
    const promo_data = await buildPromoData(terms, rewards, oldData);

    let options = [];
    switch (data.type) {
      case promo_types.buy_x_free_y:
        options = [...reward_options, ...term_options];
        break;
      case promo_types.buy_x_pay_y:
      case promo_types.free_item:
      case promo_types.multi_price:
      case promo_types.min_qty:
        options = [...term_options];
        break;
      default:
        break;
    }

    return {
      promo_data,
      terms,
      rewards,
      options,
    };
  };

  const buildPromoData = async (terms, rewards, oldData) => {
    const { data } = payload;

    await validatePromoData(oldData);

    if (data._id) {
      return {
        ...oldData,
        ...data,
        terms: terms._id,
        rewards: rewards._id,
      };
    }

    delete data.term_logic;
    delete data.reward_logic;

    return {
      _id: new BSON.ObjectId(),
      __v: 0,
      _partition: data.outlet.toString(),
      user_id: BSON.ObjectId(user_id),
      license: license,
      outlet: data.outlet,
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user_id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),
      terms: terms._id,
      rewards: rewards._id,
      is_disc: false,
      ...data,
    };
  };

  const termValidation = (term) => {
    const { data } = payload;
    if (term) {
      return;
    }
    valid.isObjValid(data, "term_products", "E20172BE", true);
    valid.isObjValid(data, "term_logic", "E20193BE", true);

    if (data.term_product_type === "group") {
      throw new Error("E20199BE");
    }

    if (data.term_product_type === "department" && data.term_logic !== "or")
      throw new Error("E20193BE");

    if (["or", "and"].includes(data.term_logic)) {
      data.term_products.map((v) => {
        if (v.qty < 1) throw new Error("E20203BE");
      });
    }

    if (
      data.term_logic === "cross" &&
      (!data.term_value || data.term_value < 1)
    ) {
      // cross && term product minimal 1
      throw new Error("E20174BE");
    }
  };

  const rewardValidation = (reward) => {
    const { data } = payload;

    if (!reward) {
      return;
    }
    valid.isObjValid(data, "reward_products", "E20173BE", true);

    if (data.reward_logic === "or" || data.reward_logic === "and") {
      data.reward_products.map((v) => {
        if (v.qty < 1) throw new Error("E20195BE");
      });
    }

    if (
      data.reward_logic === "cross" &&
      (!data.reward_value || data.reward_value < 1)
    ) {
      // cross && term product minimal 1
      throw new Error("E20195BE");
    }
  };

  const productQtyValidation = (term, reward) => {
    termValidation(term);
    rewardValidation(reward);
  };

  const buildOptionsData = async (build_type, oldData) => {
    const { data } = payload;
    const options =
      build_type == "term" ? data.term_products : data.reward_products;
    const type =
      build_type == "term" ? data.term_product_type : data.reward_product_type;

    if (!options) {
      return [];
    }

    const oldDataKey = build_type == "term" ? "terms" : "rewards";

    const oldOptions = oldData ? oldData[oldDataKey].options : null;

    if (oldOptions) {
      const deletedOption = oldOptions.reduce((prev, opt) => {
        if (!options.includes(opt.object.toString())) {
          return [...prev, BSON.ObjectId(opt._id.toString())];
        }
        return prev;
      }, []);
      await db
        .collection(promo_option)
        .deleteMany({ _id: { $in: deletedOption }, license });
    }

    return options.reduce((prev, option, i) => {
      const findOption =
        oldOptions?.find((opt) => {
          return opt.object.toString() == option.id.toString();
        }) || null;

      if (findOption) {
        option = {
          ...findOption,
          qty: parseInt(option.qty),
        };
      } else {
        option = {
          _id: new BSON.ObjectId(),
          __v: parseInt(0),
          _partition: data.outlet.toString(),
          active: true,
          user_id: BSON.ObjectId(user_id),
          license,
          createdAt: new Date(),
          createdBy: BSON.ObjectId(user_id),
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user_id),
          object: BSON.ObjectId(option.id),
          qty: parseInt(option.qty),
          type,
        };
      }

      // type promo di bawah ini tidak memiliki option qty
      if (
        [promo_types.free_item, promo_types.multi_price].includes(data.type)
      ) {
        delete option.qty;
      }

      return [...prev, option];
    }, []);
  };

  const buildRewardData = (options, oldData) => {
    let { data } = payload;

    let v = {
      _id: new BSON.ObjectId(),
      __v: 0,
      _partition: data.outlet.toString(),
      active: true,
      user_id: BSON.ObjectId(user_id),
      license: license,
      outlet: data.outlet,
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user_id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),
      target: "item",
      type: "transaction",
    };

    if (oldData) {
      v = oldData.rewards;
    }

    if (data.reward_type && data.reward_type == "percentage") {
      if (data.value < 0) {
        data.value = 0;
      }

      if (data.value > 100) {
        data.value = 100;
      }
    }

    switch (data.type) {
      case promo_types.buy_x_free_y:
        v.options = options.map((option) => option._id);
        v.logic = data.reward_logic;
        v.value = parseFloat(data.reward_value);
        break;
      case promo_types.buy_x_pay_y:
        /*
          logic disini sedikit membingungkan
          dikarenakan value_type bergantung pada reward_category yg send dari sisi FE
          maka dari itu ketika di method GET data yg di dapat dari db field `reward_category`
          harus di format sesuai logika di bawah
        */
        if (data.reward_category == "discount") {
          v.value_type = data.reward_type;
        } else if (data.reward_category == "quantity") {
          v.value_type = data.reward_category;
        } else if (data.reward_category == "nominal") {
          v.value_type = "amount";
        }
        v.category = data.reward_category;
        v.value = parseFloat(data.reward_value);
        break;
      case promo_types.free_item:
        v.value = parseFloat(data.reward_value);
        break;
      case promo_types.multi_price:
        v.price_level = BSON.ObjectId(data.reward_price_level_id);
        break;
      case promo_types.min_trans:
        v.target = "bill";
        v.value = parseFloat(data.reward_value);
        v.value_type = data.reward_type;
        break;
      case promo_types.min_qty:
        v.value = parseFloat(data.reward_value);
        v.value_type = data.reward_type;
        break;
      default:
        break;
    }

    return v;
  };

  const buildTermData = (options, oldData) => {
    const { data } = payload;

    let v = {
      _id: new BSON.ObjectId(),
      __v: 0,
      _partition: data.outlet.toString(),
      active: true,
      user_id: BSON.ObjectId(user_id),
      license: license,
      outlet: data.outlet,
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user_id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),
      type: "transaction",
    };

    if (oldData) {
      v = oldData.terms;
    }

    switch (data.type) {
      case promo_types.buy_x_free_y:
      case promo_types.buy_x_pay_y:
        v.options = options.map((option) => option._id);
        v.logic = data.term_logic;
        v.value = parseFloat(data.term_value);
        break;
      case promo_types.free_item:
        v.value = parseFloat(data.term_value);
        v.options = options.map((option) => option._id);
        v.logic = "cross";
        break;
      case promo_types.multi_price:
        v.options = options.map((option) => option._id);
        break;
      case promo_types.min_trans:
        v.value = parseFloat(data.term_value);
        break;
      case promo_types.min_qty:
        v.options = options.map((option) => option._id);
        v.value = parseFloat(data.term_value);
        v.logic = data.term_logic;
        break;
      default:
        break;
    }

    return v;
  };

  const getOldPromo = async () => {
    const { data } = payload;

    const promo = await db
      .collection(promo_collection)
      .aggregate([
        { $match: { _id: BSON.ObjectId(data._id.toString()), license } },
        {
          $lookup: {
            from: "promo_term",
            let: { terms: "$terms" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$terms"] } } },
              {
                $lookup: {
                  from: "promo_option",
                  localField: "options",
                  foreignField: "_id",
                  as: "options",
                },
              },
            ],
            as: "terms",
          },
        },
        {
          $unwind: {
            path: "$terms",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "promo_reward",
            let: { rewards: "$rewards" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$rewards"] } } },
              {
                $lookup: {
                  from: "promo_option",
                  localField: "options",
                  foreignField: "_id",
                  as: "options",
                },
              },
            ],
            as: "rewards",
          },
        },
        {
          $unwind: {
            path: "$rewards",
            preserveNullAndEmptyArrays: true,
          },
        },
      ])
      .toArray();

    if (promo.length == 0) {
      throw new Error("promo is not exist");
    }

    return promo[0];
  };

  const typePromoValidation = (oldData) => {
    const { data } = payload;

    if (oldData.type !== data.type) {
      throw new Error("E30096BE");
    }
  };

  const validateForceValue = () => {
    const { data } = payload;

    if (!data.active) {
      data.active = false;
    }

    if (!data.automatic) {
      data.automatic = false;
    }

    // force multiply true for promo multi_price
    if (data.type === "multi_price") {
      data.multiply = true;
    }

    if (data.type === "min_trans") {
      data.multiply = false;
    }

    if (data.start_date) {
      if (!(data.start_date instanceof Date)) {
        data.start_date = new Date(data.start_date);
      }
    } else {
      // changes ini beresiko dapat error
      // inert not permitted dan update not permitted
      // handle-nya ada di RF clientPromo, yang value-nya null akan di unset
      // hati2 saat update code ini
      data.start_date = null;
    }

    if (data.end_date) {
      if (!(data.end_date instanceof Date)) {
        data.end_date = new Date(data.end_date);
      }
    } else {
      // changes ini beresiko dapat error
      // inert not permitted dan update not permitted
      // handle-nya ada di RF clientPromo, yang value-nya null akan di unset
      // hati2 saat update code ini
      data.end_date = null;
    }

    if (data.repeat_date) {
      if (!(data.repeat_date instanceof Date)) {
        data.repeat_date = new Date(data.repeat_date);
      }
    } else {
      // changes ini beresiko dapat error
      // inert not permitted dan update not permitted
      // handle-nya ada di RF clientPromo, yang value-nya null akan di unset
      // hati2 saat update code ini
      data.repeat_date = null;
    }
  };

  const validatePromoData = async (oldData) => {
    const { data } = payload;

    if (!promo_types[data.type]) {
      throw new Error("E20171BE");
    }

    // parse data to acceptable data type
    validateForceValue();

    if (data.repeat && !data.repeat_date) {
      throw new Error("repeat_date harus di isi saat repeat di aktifkan");
    }

    await promoPriorityValidation(oldData);

    // remove payload yang tidak digunakan
    delete data.term_product_type;
    delete data.term_products;
    delete data.reward_product_type;
    delete data.reward_products;
    delete data.term_promo_type;
    delete data.reward_value;
    delete data.reward_type;
    delete data.term_value;
    delete data.reward_value;
    delete data.reward_price_level_id;
  };

  const promoPriorityValidation = async (oldData) => {
    const { data } = payload;

    if (!data._id && !data.priority) {
      data.priority = await getNextPriority();
    }

    const findPromo = await db
      .collection(promo_collection)
      .findOne(
        { outlet: data.outlet, priority: parseInt(data.priority), license },
        { _id: 1, name: 1, type: 1 }
      );

    if (findPromo) {
      if (data._id) {
        await updateDataPromo(findPromo._id, { priority: oldData.priority });
      } else {
        const nextPriority = await getNextPriority();
        await updateDataPromo(findPromo._id, { priority: nextPriority });
      }
    }
  };

  const updateDataPromo = async (id, dataUpdate) => {
    await db.collection(promo_collection).updateOne(
      { _id: id, license },
      {
        $set: {
          priority: parseInt(dataUpdate.priority),
        },
      }
    );
  };

  /*
    Reward category nominal term logic bisa and , or atau cross .
    Hasil meeting dengan mas yudha dan mas decky 16 Jan 2023 .
  */
  const xpayyValidation = () => {
    const { data } = payload;

    if (data.term_promo_type == "discount") {
      valid.isObjValid(data, "reward_type", "E20176BE", true);
      if (data.reward_value < 1 || data.reward_value > 100)
        throw new Error("E20196BE");
    }

    if (data.reward_category === "quantity") {
      if (data.term_logic !== "or") throw new Error("E20197BE");

      data.term_products.map((obj) => {
        if (data.reward_value >= obj.qty) throw new Error("E20198BE");
      });
    }

    valid.isObjValid(data, "reward_value", "E20177BE", true);
    productQtyValidation(true, false);
  };

  const getNextPriority = async () => {
    const { data } = payload;

    const promocount = await db
      .collection(promo_collection)
      .find(
        {
          outlet: data.outlet,
          license,
        },
        { _id: 1, priority: 1 }
      )
      .sort({ priority: -1 })
      .limit(1)
      .toArray();

    let priority = 1;
    if (promocount.length > 0 && promocount[0].priority > 0) {
      priority = promocount[0].priority + 1;
    }

    return parseInt(priority);
  };

  const freeValidation = () => {
    const { data } = payload;

    valid.isObjValid(data, "term_value", "E20178BE", true);
    valid.isObjValid(data, "reward_value", "E20177BE", true);
    valid.isObjValid(data, "term_products", "E20172BE", true);

    if (data.term_product_type === "group") {
      throw new Error("E20199BE");
    }
    if (data.reward_value > data.term_value) {
      throw new Error("E20200BE");
    }
  };

  const minTransValidation = () => {
    const { data } = payload;

    valid.isObjValid(data, "term_value", "E20178BE", true);
    valid.isObjValid(data, "reward_value", "E20177BE", true);
    valid.isObjValid(data, "reward_type", "E20176BE", true);

    if (data.term_product_type === "group") {
      throw new Error("E20199BE");
    }

    if (data.reward_type === "percentage") {
      if (data.reward_value < 1 || data.reward_value > 100)
        throw new Error("E20202BE");
      if (data.multiply) throw new Error("E20224BE");
    } else {
      if (data.reward_value > data.term_value) {
        throw new Error("E20200BE");
      }
    }
  };

  const multiPriceValidation = async () => {
    const { data } = payload;
    const termsProduct = data.term_products.map((e) => BSON.ObjectId(e.id));
    const { reward_price_level_id } = data;
    const matchBy =
      data.term_product_type === "product" ? "$_id" : "$product_department";

    // validasi reward price level di product

    let validateForProduct = await db
      .collection(products_collection)
      .aggregate([
        {
          $match: {
            $expr: {
              $in: [matchBy, termsProduct],
            },
            active: true,
          },
        },
        { $project: { prices: 1, name: 1 } },
        {
          $lookup: {
            from: "product_prices",
            let: { prices: "$prices" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      {
                        $in: ["$_id", "$$prices"],
                      },
                      {
                        $eq: [
                          "$price_level",
                          BSON.ObjectId(reward_price_level_id),
                        ],
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  _id: 1,
                },
              },
            ],
            as: "productPricesLevel",
          },
        },
        {
          $project: {
            productPricesLevel: 1,
          },
        },
      ])
      .toArray();

    let productNotValid;
    if (data.term_product_type !== "department") {
      productNotValid = validateForProduct.filter(
        (e) => e.productPricesLevel.length <= 0
      ).length;
    } else {
      validateForProduct = validateForProduct.filter(
        (e) => e.productPricesLevel.length > 0
      );
    }

    if (productNotValid) throw new Error("E30003BE");

    valid.isObjValid(data, "reward_price_level_id", "E20188BE", true);
    valid.isObjValid(data, "term_products", "E20172BE", true);
  };

  const minQyValidation = () => {
    const { data } = payload;

    valid.isObjValid(data, "term_value", "E20178BE", true);
    valid.isObjValid(data, "reward_value", "E20177BE", true);
    valid.isObjValid(data, "reward_type", "E20176BE", true);
    valid.isObjValid(data, "term_products", "E20172BE", true);

    if (data.term_product_type === "group") {
      throw new Error("E20199BE");
    }

    data.term_logic = "or";

    // karena term logic di paksa OR, jadi di masing2 option harus ada value-nya
    data.term_products = data.term_products.map((opt) => {
      return {
        ...opt,
        qty: data.term_value,
      };
    });
  };

  return Object.freeze({ buildDataToSave });
};
