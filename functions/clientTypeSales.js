exports = async (payload) => {
  try {
    const TypeSalesObject = await typeSales(payload);
    if (TypeSalesObject[payload.method]) {
      return await TypeSalesObject[payload.method]();
    }
    throw new Error("Method not found in request");
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientTypeSales"
    );
  }
};

const typeSales = async (payload) => {
  const valid = context.functions.execute("intValidation");
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  // ================ MAIN method start ========================

  /*
    exports({
      method: 'LIST',
      filter: {
        business_id: string | required,
        outlet_id: ''
      },
      data: {}
    })

    1. validation and filter
    2. get type sales
    3. return format type sales
  */
  const LIST = async () => {
    // 1. validation and filter
    await LISTValidation();

    // 2. get type sales
    const type_sales = await dbLISTGetTypeSales();

    // 3. return format type sales
    return LISTBuildDataToReturn(type_sales);
  };

  /*
    exports({
      method:'POST',
      filter:{},
      data:{
        id: string | optional,
        outlet_id: string,
        name: string,
        taxes: [string],
        price_level: string,
        active: boolean,
        default: boolean
      }
    })
    
    1. validation payload
    2. save or update data
  */
  const POST = async () => {
    // 1. validation payload
    await POSTValidation();

    // 2. save or update data
    if (!payload.data.id) {
      return dbPOSTInsert();
    } else {
      return dbPOSTUpdate();
    }
  };

  /* 
    exports({
      method:'ACTIVE',
      filter:{
        id: '615ea20d2f96da0c141df811'
      },
      data:{
        active: true
      }
    })
    
    1. validation
    2. save data
  */
  const ACTIVE = async () => {
    // 1. validation
    await ACTIVEValidation();

    // 2. save data
    await dbACTIVESave();

    return true;
  };
  // ================ MAIN method end ========================

  // ================ Helper function start ==================
  const LISTValidation = async () => {
    await valid.hasPermission(["bo_utility"]);
    valid.isObjValid(payload, "filter", "E20037BE", true);
    valid.isObjValid(payload.filter, "business_id", "E20110BE", true);

    payload.filter.license = user.license;

    await LISTValidateOutletOrBusiness();
  };

  const LISTValidateOutletOrBusiness = async () => {
    const outlet_in_bussiness = await context.functions.execute(
      "intOutletsFromBusiness",
      payload.filter.business_id
    );
    delete payload.filter.business_id;

    if (payload.filter.outlet_id) {
      const outletId = outlet_in_bussiness.find(
        (v) => v.toString() == payload.filter.outlet_id.toString()
      );

      if (!outletId) throw new Error("E30032BE");

      payload.filter.outlet = BSON.ObjectId(outletId.toString());
    } else {
      payload.filter.outlet = { $in: outlet_in_bussiness };
    }
    delete payload.filter.outlet_id;
  };

  const LISTBuildDataToReturn = (type_sales) => {
    return type_sales.map((v) => {
      v.id = v._id.toString();

      if (v.outlet) {
        v.outlet_id = v.outlet._id.toString();
        v.outlet_name = v.outlet.name;
      }

      v.taxes = v.taxes.map((vTax) => {
        vTax.id = vTax._id.toString();
        delete vTax._id;

        return vTax;
      });

      v.price_level_id = v.price_level._id.toString();
      v.price_level_name = v.price_level.name;
      delete v.price_level;

      delete v._id;
      delete v.outlet;
      delete v.lowerName;

      return v;
    });
  };

  const POSTValidation = async () => {
    const { data } = payload;

    // validasi ACL
    await valid.hasPermission(["bo_utility"]);

    // cek validation request
    valid.isObjValid(data, "name", "E20074BE", true);
    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(data, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "price_level", "E20043BE", true);

    // cek name is unique
    await valid.isUnique(data, collectionNames.type_sales, "name", "E30041BE");

    if (data.default && !data.active) throw new Error("E20016BE");

    if (data.outlet_id) {
      data.outlet = BSON.ObjectId(data.outlet_id.toString());
      delete data.outlet_id;

      // validate outlet
      await valid.isDataExists(
        collectionNames.outlet,
        {
          _id: data.outlet,
          license: BSON.ObjectId(user.license.toString()),
        },
        "E30032BE"
      );
    }

    if (data.price_level) {
      data.price_level = BSON.ObjectId(data.price_level);
      // validate price level
      await valid.isDataExists(
        collectionNames.price_levels,
        {
          _id: data.price_level,
          license: BSON.ObjectId(user.license.toString()),
        },
        "E30032BE"
      );
    }

    if (data.taxes && data.taxes.length > 0) {
      const list_taxes_id = data.taxes.map((v) => BSON.ObjectId(v));

      const find_taxes = await db
        .collection(collectionNames.taxes)
        .find(
          {
            _id: { $in: list_taxes_id },
            license: BSON.ObjectId(user.license.toString()),
          },
          {
            _id: 1,
          }
        )
        .toArray();

      if (find_taxes.length !== list_taxes_id.length) {
        throw new Error("E30040BE");
      }

      data.taxes = list_taxes_id;
    }

    // jika default = false
    // check apakah data ini sebelumnya default = true
    // jika sebelumnya data ini default = true,
    // tidak bisa di update jadi false
    if (data.id && (!data.default || !data.active)) {
      if (await dbISDefaultTypeSales(BSON.ObjectId(data.id))) {
        throw new Error("E30114BE");
      }
    }
  };

  const ACTIVEValidation = async () => {
    const { data, filter } = payload;

    // validate request
    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(filter, "id", "E20072BE", true);

    // default type sales tidak bisa di non-active-kan
    if (!data.active) {
      if (await dbISDefaultTypeSales(BSON.ObjectId(filter.id))) {
        throw new Error("E30114BE");
      }
    }
  };
  // ================ Helper function end ====================

  // ================ DB function start ====================
  const dbLISTGetTypeSales = () => {
    return db
      .collection(collectionNames.type_sales)
      .aggregate([
        {
          $match: {
            ...payload.filter,
          },
        },
        {
          $lookup: {
            from: "outlet",
            let: { outlet: "$outlet" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$outlet"] } } },
              { $project: { _id: 1, name: 1 } },
            ],
            as: "outlet",
          },
        },
        {
          $unwind: {
            path: "$outlet",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "taxes",
            let: { taxes: "$taxes" },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", { $ifNull: ["$$taxes", []] }] },
                },
              },
              {
                $project: { _id: 1, name: 1 },
              },
            ],
            as: "taxes",
          },
        },
        {
          $lookup: {
            from: "price_levels",
            let: { price: "$price_level" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$price"] } } },
              { $project: { _id: 1, name: 1 } },
            ],
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
            _id: 1,
            name: 1,
            active: 1,
            outlet: 1,
            taxes: 1,
            price_level: 1,
            default: 1,
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();
  };

  const dbPOSTInsert = async () => {
    const { data } = payload;

    const data_type_sales = {
      _id: new BSON.ObjectId(),
      __v: 0,
      outlet: data.outlet,
      name: data.name,
      taxes: data.taxes,
      price_level: data.price_level,
      active: data.active,
      default: data.default,
      _partition: data.outlet.toString(),
      user_id: BSON.ObjectId(user._id.toString()),
      license: BSON.ObjectId(user.license.toString()),
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user._id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    // insert data typeSales
    const typeSale = await db
      .collection(collectionNames.type_sales)
      .insertOne(data_type_sales);

    // cek apakah default set true
    data.id = data_type_sales._id;
    if (data_type_sales.default) {
      await dbPOSTUpdateDefaultTypeSales();
    }

    return typeSale.insertedId;
  };

  const dbPOSTUpdate = async () => {
    const { data } = payload;

    const data_to_update = {
      outlet: data.outlet,
      name: data.name,
      taxes: data.taxes,
      price_level: data.price_level,
      active: data.active,
      default: data.default,
      user_id: BSON.ObjectId(user._id.toString()),
      license: BSON.ObjectId(user.license.toString()),
      _partition: data.outlet.toString(),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    delete data_to_update.id;

    // jika default = true, replace data lain yang memiliki value default = true
    if (data_to_update.default) {
      await dbPOSTUpdateDefaultTypeSales();
    }

    await db.collection(collectionNames.type_sales).updateOne(
      {
        _id: BSON.ObjectId(data.id),
        license: user.license,
      },
      {
        $set: { ...data_to_update },
        $inc: { __v: 1 },
      }
    );

    return data.id;
  };

  const dbPOSTUpdateDefaultTypeSales = () => {
    const { data } = payload;

    return db.collection(collectionNames.type_sales).updateMany(
      {
        outlet: data.outlet,
        license: user.license,
        default: true,
        _id: { $ne: data.id },
      },
      {
        $set: { default: false },
      }
    );
  };

  const dbISDefaultTypeSales = async (_id) => {
    const find_out_default = await db
      .collection(collectionNames.type_sales)
      .count({
        _id,
        license: user.license,
        default: true,
      });

    return Number(find_out_default) != 0;
  };

  const dbACTIVESave = async () => {
    const { data, filter } = payload;

    await db.collection(collectionNames.type_sales).updateOne(
      {
        _id: BSON.ObjectId(filter.id.toString()),
        license: user.license,
      },
      {
        $set: {
          active: data.active,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id),
        },
        $inc: { __v: 1 },
      }
    );
  };
  // ================ DB function end ======================

  return Object.freeze({ LIST, POST, ACTIVE });
};
