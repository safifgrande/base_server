exports = async (payload) => {
  try {
    const taxesObject = await taxes(payload);
    if (taxesObject[payload.method]) {
      return await taxesObject[payload.method]();
    }
    throw new Error("Method not found in request");
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientTaxes"
    );
  }
};

const taxes = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  // ================ MAIN method start ========================

  /*
    exports({
      method: 'LITE',
      filter: {
        business_id:'611e1583f7bf5674c1785823',
        outlet_id: '611e1583f7bf5674c1785822'
      },
      data: {}
    })
  */
  const LITE = async () => {
    await validationAndFilterList();
    const { filter } = payload;

    if (!filter.active) {
      filter.active = true;
    }

    const taxes_lite = await queryTaxes({
      _id: 1,
      name: 1,
    });

    return taxes_lite.map((v) => {
      v.id = v._id.toString();
      delete v._id;

      return v;
    });
  };

  /*
    exports({
      method: 'LIST',
      filter: {
        business_id:'611e1583f7bf5674c1785823',
        outlet_id: '611e1583f7bf5674c1785822'
      },
      data: {}
    })
  */
  const LIST = async () => {
    await validationAndFilterList();

    const taxes_list = await queryTaxes({
      _id: 1,
      name: 1,
      taxRate: 1,
      salesTax: 1,
      beforeDisc: 1,
      outlet: 1,
      active: 1,
    });

    return formatingReturn(taxes_list);
  };

  /*
    ------------ Create Taxes ----------
    exports({
      method: 'POST',
      filter: {},
      data: {
        name:'tax 3%',
        outlet_id:'611e1583f7bf5674c1785822',
        salesTax: true,
        taxRate: 3,
        active: true
      }
    })

    - validation request
    - validation existing outlet
    - validation name taxes isunique
    - data taxes before insert
    - insert to collection
  */
  const POST = async () => {
    await POSTValidation();

    return await createOrUpdate();
  };

  /*
    exports({
      method:'ACTIVE',
      filter:{
        id: '600e74ebe4442131b16bc136',
      },
      data:{
        active: true,
      }
    })

    1. validation
    2. update taxes
  */
  const ACTIVE = async () => {
    // 1. validation
    await ACTIVEValidation();

    // 2. update taxes
    await dbACTIVEUpdateTaxes();

    return payload.filter.id;
  };

  // ================ MAIN method end   ========================

  // ================ Helper function start ==================

  const getLastTax = async () => {
    const { data } = payload;

    return await db.collection(collectionNames.taxes).findOne(
      {
        outlet: BSON.ObjectId(data.outlet_id),
        license: BSON.ObjectId(user.license.toString()),
      },
      { beforeDisc: 1 }
    );
  };

  const POSTValidation = async () => {
    const { data } = payload;
    await valid.hasPermission(["bo_utility"]);

    // check request body data
    valid.isObjValid(data, "name", "E20076BE", true);
    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(data, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "salesTax", "E20074B", true);
    valid.isObjValid(data, "taxRate", "E20075BE", true);

    // check existing outlet
    await valid.isDataExists(
      collectionNames.outlet,
      {
        _id: BSON.ObjectId(data.outlet_id.toString()),
        license: BSON.ObjectId(user.license.toString()),
      },
      "E30032BE"
    );

    // check existing name taxes
    await valid.isUnique(data, collectionNames.taxes, "name", "E20077BE");

    if (data.id) {
      if (!data.active) {
        await dbPOSTIsUsedOnTypeSales(data);
      }
    }
  };

  const ACTIVEValidation = async () => {
    const { filter, data } = payload;

    await valid.hasPermission(["bo_utility"]);
    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(filter, "id", "E20009BE", true);
    valid.isObjValid(filter, "outlet_id", "E20033BE", true);

    if (!data.active) {
      await dbPOSTIsUsedOnTypeSales(filter);
    }
  };
  // ================ Helper function end   ==================
  const formatingReturn = (taxes_list) => {
    return taxes_list.map((v) => {
      const { _id, outlet } = v;
      delete v._id;

      v.outlet_id = outlet._id.toString();
      v.outlet_name = outlet.name;
      delete v.outlet;
      delete v.lowerName;

      return {
        id: _id.toString(),
        ...v,
      };
    });
  };

  const queryTaxes = async (project) => {
    return await db
      .collection(collectionNames.taxes)
      .aggregate([
        {
          $match: { ...payload.filter },
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
          $project: { ...project, lowerName: { $toLower: "$name" } },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();
  };

  const validationAndFilterList = async () => {
    let { filter } = payload;

    await valid.hasPermission(["bo_utility"]);

    if (!filter) {
      filter = {};
    }

    filter.license = BSON.ObjectId(user.license.toString());

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
  };

  const createOrUpdate = async () => {
    const { data } = payload;
    if (data.salesTax) await dbNonactiveDefaultTax();
    if (!data.id) {
      // get last tax untuk mendapatkan status beforeDisc terakhir dari taxes di outlet
      const get_last_tax = await getLastTax();

      return (await createNewTax(get_last_tax.beforeDisc)).insertedId;
    } else {
      return await dbUpdateExistingTax();
    }
  };

  // Database helper ==============
  const dbNonactiveDefaultTax = async () => {
    const { data } = payload;
    let salesTax = false;

    // jika update data, cek apakah status salesTax sebelumnya true
    if (data.id) {
      const oldData = await db.collection(collectionNames.taxes).findOne({
        _id: BSON.ObjectId(data.id.toString()),
        license: BSON.ObjectId(user.license.toString()),
      });
      salesTax = oldData.salesTax;
    }

    if (!salesTax) {
      return await db.collection(collectionNames.taxes).updateMany(
        {
          salesTax: true,
          license: BSON.ObjectId(user.license.toString()),
        },
        { $set: { salesTax: false } }
      );
    }
  };

  const createNewTax = async (before_disc) => {
    const { data } = payload;

    const dataTax = {
      __v: 0,
      _id: new BSON.ObjectId(),
      _partition: data.outlet_id.toString(),
      name: data.name,
      active: data.active,
      beforeDisc: before_disc,
      license: BSON.ObjectId(user.license.toString()),
      outlet: BSON.ObjectId(data.outlet_id.toString()),
      user_id: BSON.ObjectId(user._id.toString()),
      salesTax: data.salesTax,
      taxRate: parseFloat(data.taxRate),
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user._id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    return await db.collection(collectionNames.taxes).insertOne(dataTax);
  };

  const dbUpdateExistingTax = async () => {
    const { data } = payload;

    const dataUpdate = {
      name: data.name,
      active: data.active,
      salesTax: data.salesTax,
      taxRate: parseFloat(data.taxRate),

      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    await db.collection(collectionNames.taxes).updateOne(
      {
        _id: BSON.ObjectId(data.id.toString()),
        license: BSON.ObjectId(user.license.toString()),
      },
      {
        $set: dataUpdate,
        $inc: { __v: 1 },
      }
    );

    return data.id.toString();
  };

  const validationDisc = async () => {
    const { data, filter } = payload;

    // validation
    valid.isObjValid(filter, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "before_disc", "E20073BE", true);

    // check existing outlet
    await valid.isDataExists(
      collectionNames.outlet,
      {
        _id: BSON.ObjectId(filter.outlet_id.toString()),
        license: BSON.ObjectId(user.license.toString()),
      },
      "E30032BE"
    );
  };

  const BEFORE_DISC = async () => {
    /*
     exports({
        method: 'BEFORE_DISC',
        filter: {
          outlet_id:'611e1583f7bf5674c1785822',
        },
        data: {
          before_disc: true
        }
      })
   */

    const { data, filter } = payload;

    // validation
    await validationDisc();

    await db.collection(collectionNames.taxes).updateMany(
      {
        outlet: BSON.ObjectId(filter.outlet_id),
        license: BSON.ObjectId(user.license.toString()),
      },
      {
        $set: {
          beforeDisc: data.before_disc,
        },
        $inc: { __v: 1 },
      }
    );

    return true;
  };

  const dbPOSTIsUsedOnTypeSales = async ({ id, outlet_id }) => {
    const taxUsed = await db
      .collection(collectionNames.taxes)
      .aggregate([
        {
          $match: {
            _id: BSON.ObjectId(id),
            outlet: BSON.ObjectId(outlet_id),
            license: user.license,
            active: true,
          },
        },
        {
          $lookup: {
            from: "type_sales",
            foreignField: "taxes",
            localField: "_id",
            as: "ts",
          },
        },
        {
          $project: { _id: 1, ts: { _id: 1 } },
        },
        {
          $unwind: "$ts",
        },
        { $group: { _id: null, tsCount: { $sum: 1 } } },
        { $project: { _id: 0 } },
      ])
      .toArray();

    if (taxUsed.length > 0) throw new Error("E30004BE");
  };

  const dbACTIVEUpdateTaxes = async () => {
    const { filter, data } = payload;
    const dataUpdate = {
      active: data.active,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    await db.collection(collectionNames.taxes).updateOne(
      {
        _id: BSON.ObjectId(filter.id),
        outlet: BSON.ObjectId(filter.outlet_id),
        license: user.license,
      },
      {
        $set: { ...dataUpdate },
        $inc: { __v: 1 },
      }
    );
  };

  return Object.freeze({
    POST,
    LIST,
    LITE,
    ACTIVE,
    BEFORE_DISC,
  });
};
