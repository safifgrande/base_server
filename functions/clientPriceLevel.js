module.exports = async (payload) => {
  try {
    const priceLevelObject = await priceLevel(payload);

    if (!priceLevelObject[payload.method]) {
      throw new Error("Method not found in request");
    }
    return await priceLevelObject[payload.method]();
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientPriceLevel"
    );
  }
};

const priceLevel = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  /*
    {
      method: 'LIST',
      filter: {
        business_id:"6156606885345c6e13961071",
        outlet_id: "6156606885345c6e13961070", //optional
        active: true // optional(default true)

      }
    }
  */
  // function untuk mendapatkan priceLevel, untuk support product management
  // jika kedepannya butuh di tambah response untuk keperluan selain product management,
  // lebih baik membuat method baru lagi, utamakan response yang diperlukan
  const LIST = async () => {
    await listValidation();

    return dbGetPriceLevels();
  };

  const listValidation = async () => {
    const { filter } = payload;

    // validation
    await valid.hasPermission(["bo_product", "bo_utility"]);
    if (!filter) throw new Error("E20037BE");
    if (!filter.outlet_id) throw new Error("E20033BE");

    // default filter
    filter.license = BSON.ObjectId(user.license.toString());

    // request dari FE smeentara filter bisnis di comment
    /*
    payload filter
    let outlet_in_bussiness = await context.functions.execute("intOutletsFromBusiness", filter.business_id);

    if (filter.outlet_id) {
      const outletId = outlet_in_bussiness.find((v) => v.toString() == filter.outlet_id.toString());

      if (!outletId) throw new Error("E30032BE");

      filter.outlet = BSON.ObjectId(outletId.toString());
    } else {
      filter.outlet = { $in: outlet_in_bussiness };
    }
    */

    filter.outlet = await BSON.ObjectId(filter.outlet_id.toString());

    delete filter.outlet_id;
    delete filter.business_id;
  };

  const dbGetPriceLevels = async () => {
    return (
      await db
        .collection(collectionNames.price_levels)
        .find(payload.filter, { _id: 1, name: 1, default: 1, active: 1 })
        .sort({ default: -1 })
        .toArray()
    ).map(({ _id, ...v }) => {
      return {
        ...v,
        id: _id.toString(),
      };
    });
  };

  const getUpdatePriceList = (data) => {
    return data.price_labels.reduce((prev, curr) => {
      curr.id && prev.push(BSON.ObjectId(curr.id.toString()));
      return prev;
    }, []);
  };

  const prepareDataToSave = async () => {
    const { filter, data } = payload;

    let result = {
      newData: [],
      editedData: [],
    };

    const dataPriceLevel = {
      __v: 0,
      _partition: filter.outlet.toString(),
      user_id: BSON.ObjectId(user._id.toString()),
      license: filter.license,
      outlet: filter.outlet,
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user._id.toString()),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id.toString()),
    };

    // prepare update data list
    const update_price_list = getUpdatePriceList(data);

    const find_price = await getTotalPriceLevelUsed(update_price_list);

    find_price.forEach((v) => {
      const price_level = data.price_labels.find(
        (el) => el.id.toString() === v._id.toString()
      );

      if (v.active !== price_level.active || v.name !== price_level.name) {
        result.editedData = [
          ...result.editedData,
          {
            ...price_level,
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user._id.toString()),
          },
        ];

        // price level default can't be renamed
        if (v.default === true && price_level.name !== v.name) {
          throw new Error("E30119BE");
        }

        // price level is already used on the active product can't be nonactive
        // price level default can't be nonactive
        if (price_level.active === false) {
          if (v.default === true || v.product_prices.length > 0) {
            throw new Error("E30118BE");
          }
          if (v.promo_reward.length > 0) throw new Error("E30129BE");
        }
      }
    });

    // prepare insert data list
    const insert_price_list = data.price_labels.filter((v) => !v.id);

    insert_price_list.forEach((price_level) => {
      const addField = {
        _id: new BSON.ObjectId(),
        default: false,
      };
      delete price_level.id;

      result.newData = [
        ...result.newData,
        {
          ...price_level,
          ...dataPriceLevel,
          ...addField,
        },
      ];
    });

    return result;
  };

  const checkIsDataExistInDB = async () => {
    const { filter, data } = payload;

    const list_price_labels = data.price_labels.reduce((prev, curr) => {
      curr.id && prev.push(BSON.ObjectId(curr.id.toString()));
      return prev;
    }, []);

    const get_list_id = await db
      .collection(collectionNames.price_levels)
      .find(
        {
          _id: { $in: list_price_labels },
          ...filter,
        },
        {
          _id: 1,
        }
      )
      .toArray();

    if (get_list_id.length !== list_price_labels.length) {
      throw new Error("E30077BE");
    }
  };

  const postValidation = async () => {
    const { filter, data } = payload;

    // validate ACL
    if (!(await valid.hasPermission(["bo_product", "bo_utility"], false))) {
      return [];
    }

    valid.isObjValid(data, "outlet_id", "E20033BE", true);

    data.price_labels.forEach((val) => {
      valid.isObjValid(val, "id", "E30077BE", false);
      valid.isObjValid(val, "name", "E20105BE", true);
      valid.isObjValid(val, "active", "E20062BE", true);
    });

    await valid.isDataExists(
      collectionNames.outlet,
      {
        _id: BSON.ObjectId(data.outlet_id.toString()),
        license: BSON.ObjectId(user.license.toString()),
      },
      "E30032BE"
    );

    // check if price_labels has duplicate name value?
    const uniqueName = [
      ...new Set(data.price_labels.map((v) => v.name.toLowerCase())),
    ];
    if (uniqueName.length < data.price_labels.length) {
      throw new Error("E30121BE"); // not unique
    }

    // check if price_labels is unique?
    const list_price_labels = data.price_labels.map((v) => {
      return {
        id: !v?.id ? "" : v.id.toString(),
        name: v.name.toLowerCase(),
      };
    });

    const get_list_price = await db
      .collection(collectionNames.price_levels)
      .find(
        {
          outlet: BSON.ObjectId(data.outlet_id.toString()),
          license: BSON.ObjectId(user.license.toString()),
        },
        {
          _id: 1,
          name: 1,
        }
      )
      .toArray();

    get_list_price.forEach((v) => {
      if (
        list_price_labels.find(
          (el) => el.id === "" && el.name === v.name.toLowerCase()
        )
      ) {
        throw new Error("E30014BE");
      }

      if (
        list_price_labels.find(
          (el) =>
            el.id !== "" &&
            el.id !== v._id.toString() &&
            el.name === v.name.toLowerCase()
        )
      ) {
        throw new Error("E30014BE");
      }
    });

    filter.license = BSON.ObjectId(user.license.toString());
    filter.outlet = BSON.ObjectId(data.outlet_id.toString());

    delete data.outlet_id;
  };

  /*
  exports({
    method: "POST",
    filter: {},
    data: {
      outlet_id: "62a5d4cc15d14c6d6ccf7b87",
      price_labels: [
        {
          id: "62a5d4cc15d14c6d6ccf7b9f", // id optional (ada id nya jika ingin mengupdate)
          name: "Gojek", //required
          active: false, //required
        },
        {
          id: "", // jika id kosong maka akan diproses insert
          name: "Normal", //required
          active: true, //required
        },
      ],
    },
  })
  */

  // di fe bo saat edit price level bisa mengupdate data sekaligus menambah data
  const POST = async () => {
    await postValidation();

    await checkIsDataExistInDB(); //check apakah data yang memiliki id ada di db

    const getDataToSave = await prepareDataToSave(); //menyiapkan data yang akan disimpan

    let result = [];
    if (getDataToSave.newData.length > 0) {
      // insert all new data
      const newPriceLevel = getDataToSave.newData.map((data) => {
        return {
          insertOne: {
            document: { ...data },
          },
        };
      });

      await db
        .collection(collectionNames.price_levels)
        .bulkWrite(newPriceLevel);

      result.push(...getDataToSave.newData.map((v) => v._id.toString()));
    }

    if (getDataToSave.editedData.length > 0) {
      //update all edited data
      const updatePriceLevel = getDataToSave.editedData.map((data) => {
        const dataUpdate = {
          ...data,
        };
        delete dataUpdate.id;

        return {
          updateOne: {
            filter: {
              _id: BSON.ObjectId(data.id.toString()),
              license: user.license,
            },
            update: {
              $set: { ...dataUpdate },
              $inc: { __v: 1 },
            },
          },
        };
      });

      await db
        .collection(collectionNames.price_levels)
        .bulkWrite(updatePriceLevel);

      result.push(...getDataToSave.editedData.map((v) => v.id.toString()));
    }

    return result;
  };

  const getTotalPriceLevelUsed = async (price_list_id) => {
    const { filter } = payload;

    return db
      .collection(collectionNames.price_levels)
      .aggregate([
        {
          $match: {
            _id: { $in: price_list_id },
            ...filter,
          },
        },
        {
          $lookup: {
            from: "product_prices",
            localField: "_id",
            foreignField: "price_level",
            as: "product_prices",
          },
        },
        {
          $unwind: {
            path: "$product_prices",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "promo_reward",
            localField: "_id",
            foreignField: "price_level",
            as: "promo_reward",
          },
        },
        {
          $group: {
            _id: {
              _id: "$_id",
              name: "$name",
              active: "$active",
              default: "$default",
            },
            product_prices: { $push: "$product_prices" },
            promo_reward: { $push: "$promo_reward._id" },
          },
        },
        {
          $project: {
            _id: "$_id._id",
            name: "$_id.name",
            default: "$_id.default",
            active: "$_id.active",
            "product_prices.price_level": 1,
            "product_prices.value": 1,
            promo_reward: { $first: "$promo_reward" },
          },
        },
      ])
      .toArray();
  };

  return Object.freeze({ LIST, POST });
};
