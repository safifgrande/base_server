exports = async (payload) => {
  try {
    const discountObject = await discountFunction(payload);

    const { method } = payload;
    if (discountObject[method]) {
      return await discountObject[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientDiscount"
    );
  }
};

const discountFunction = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { outlet, discounts } = context.values.get("COLLECTION_NAMES");
  const discountEnums = context.values.get("COLLECTION_ENUMS").discount;

  const { license, _id: user_id } = context.functions.execute("intUserContext");

  /*
  exports(
    {
     method: 'LIST',
     data: null,
     filter: {
       "business_id":"6156606885345c6e13961071",
        "outlet_id":"6156606885345c6e13961070",
     }
    }
  )
  */
  const LIST = async () => {
    await listValidation();

    const discount_list = await getDiscountList();

    return listReturnFormat(discount_list);
  };

  /*
  exports(
    {
      method: 'POST',
      data: {
        id: "",
        active: true,
        outlet_id: "6156606885345c6e13961070",
        name: "discount 10%",
        category: "item",
        type: "precentage",
        value: 10,
      },
      filter: null,
    }
  )
*/
  const POST = async () => {
    await postValidation();

    rateValidation();

    return saveDiscount();
  };

  /*
  exports(
    {
      method: 'ACTIVE',
      data: {
        active: true
      },
      filter: {
        id: '6182390d299641e4e450284c'
      }
    }
  )
  */

  const ACTIVE = async () => {
    await activeValidation();

    const find_discount = await updateActiveDiscount();

    if (!find_discount) {
      throw new Error("E30088BE");
    }

    return find_discount._id.toString();
  };

  const updateActiveDiscount = async () => {
    const { data, filter } = payload;

    const dataUpdate = {
      active: data.active,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),
    };

    return db.collection(discounts).findOneAndUpdate(
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
    const { data, filter } = payload;

    await valid.hasPermission(["bo_utility"]);
    valid.isObjValid(filter, "id", "E20072BE", true);
    valid.isObjValid(data, "active", "E20062BE", true);

    filter._id = BSON.ObjectId(filter.id.toString());
    filter.license = license;

    delete filter.id;
  };

  const rateValidation = () => {
    const { data } = payload;
    if (data.type == discountEnums.type.percentage) {
      if (data.value > 100 || data.value < 1) {
        throw new Error("E20150BE");
      }
    }
  };

  const createDiscount = async (data) => {
    const dataDiscount = {
      _id: new BSON.ObjectId(),
      __v: 0,
      _partition: data.outlet.toString(),
      active: data.active,
      user_id: BSON.ObjectId(user_id),
      license: license,
      outlet: BSON.ObjectId(data.outlet.toString()),
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user_id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),

      name: data.name,
      category: data.category,
      type: data.type,
      rate: parseFloat(data.value),
    };

    const discount = await db.collection(discounts).insertOne(dataDiscount);

    return discount.insertedId.toString();
  };

  const updateDiscount = async (data) => {
    const dataUpdate = {
      ...data,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),
      rate: parseFloat(data.value),
    };

    delete dataUpdate.id;
    delete dataUpdate.outlet;
    delete dataUpdate.value;

    const finddiscount = await db.collection(discounts).findOneAndUpdate(
      {
        _id: BSON.ObjectId(data.id.toString()),
        license,
      },
      {
        $set: { ...dataUpdate },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1 },
      }
    );

    if (!finddiscount) {
      throw new Error("E30088BE");
    }

    return finddiscount._id.toString();
  };

  const saveDiscount = async () => {
    const { data } = payload;

    if (data.id) {
      return updateDiscount(data);
    } else {
      return createDiscount(data);
    }
  };

  const postValidation = async () => {
    const { data } = payload;

    await valid.hasPermission(["bo_utility"]);

    valid.isObjValid(data, "id", "E20103BE", false);
    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(data, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "name", "E20152BE", true);
    valid.isObjValid(data, "category", "E20153BE", true);
    valid.isObjValid(data, "type", "E20154BE", true);
    valid.isObjValid(data, "value", "E20155BE", true);

    // check existing outlet
    await valid.isDataExists(
      outlet,
      {
        _id: BSON.ObjectId(data.outlet_id.toString()),
        license: license,
      },
      "E30032BE"
    );

    await valid.isUnique(data, discounts, "name", "E30087BE");

    data.outlet = data.outlet_id;
    delete data.outlet_id;
  };

  const getDiscountList = async () => {
    return db
      .collection(discounts)
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
          $project: {
            active: 1,
            name: 1,
            category: 1,
            type: 1,
            rate: 1,
            outlet: { _id: 1, name: 1 },
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();
  };

  const listReturnFormat = (discount_list) => {
    return discount_list.map(
      ({ _id, outlet: { _id: outlet_id, name: outlet_name }, ...discount }) => {
        delete discount.lowerName;
        return {
          id: _id.toString(),
          outlet_id: outlet_id.toString(),
          outlet_name,
          ...discount,
        };
      }
    );
  };

  const listValidation = async () => {
    await valid.hasPermission(["bo_utility"]);

    const { filter } = payload;

    valid.isRequired(payload, "filter", "E20037BE");

    valid.isRequired(filter, "business_id", "E20110BE");

    filter.license = license;

    let outlet_in_bussiness = await context.functions.execute(
      "intOutletsFromBusiness",
      filter.business_id
    );

    if (filter.outlet_id) {
      const outletId = outlet_in_bussiness.find(
        (v) => v.toString() == filter.outlet_id.toString()
      );

      if (!outletId) throw new Error("E30032BE");

      filter.outlet = BSON.ObjectId(outletId.toString());
    } else {
      filter.outlet = { $in: outlet_in_bussiness };
    }

    delete filter.business_id;
    delete filter.outlet_id;
  };

  return Object.freeze({ POST, LIST, ACTIVE });
};
