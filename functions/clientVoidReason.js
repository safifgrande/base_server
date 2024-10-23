exports = async (payload) => {
  try {
    const voidReasonsObject = await voidReason(payload);

    switch (payload.method) {
      case "LIST":
        return await voidReasonsObject.LIST();
      case "POST":
        return await voidReasonsObject.POST();
      case "ACTIVE":
        return await voidReasonsObject.ACTIVE();
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientVoidReason"
    );
  }
};

const voidReason = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");
  const user = context.functions.execute("intUserContext");

  const listValidation = async () => {
    await valid.hasPermission(["bo_utility"]);

    const { filter } = payload;

    if (!filter) {
      throw new Error("E20037BE");
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

  const getReasonList = async () => {
    return db
      .collection(collectionNames.void_reasons)
      .aggregate([
        {
          $match: {
            ...payload.filter,
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
          $project: {
            _id: 1,
            active: 1,
            title: 1,
            outlet: { _id: 1, name: 1 },
            lowerTitle: { $toLower: "$title" },
          },
        },
        { $sort: { lowerTitle: 1 } },
      ])
      .toArray();
  };

  const listReasonFormat = (voidReasons) => {
    return voidReasons.map((v) => {
      const { _id, title, outlet, active } = v;

      return {
        id: _id.toString(),
        title: title,
        outlet_id: outlet._id.toString(),
        outlet_name: outlet.name,
        active,
      };
    });
  };
  /*
  exports({
    method: 'LIST',
    filter: {},
    data: {}
  })
*/
  const LIST = async () => {
    await listValidation();

    const voidReasons = await getReasonList();

    return listReasonFormat(voidReasons);
  };

  const postValidation = async () => {
    const { data } = payload;

    await valid.hasPermission(["bo_utility"]);

    valid.isObjValid(data, "id", "E20103BE", false);
    valid.isObjValid(data, "title", "E20104BE", true);
    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(data, "outlet_id", "E20033BE", true);

    if (data.title.length > 30) {
      throw new Error("E20121BE");
    }

    // check existing outlet
    await valid.isDataExists(
      collectionNames.outlet,
      {
        _id: BSON.ObjectId(data.outlet_id.toString()),
        license: BSON.ObjectId(user.license.toString()),
      },
      "E30032BE"
    );

    await valid.isUnique(
      data,
      collectionNames.void_reasons,
      "title",
      "E30055BE"
    );

    data.outlet = data.outlet_id;
    delete data.outlet_id;
  };

  const createReason = async (data) => {
    const dataReason = {
      __v: 0,
      _id: new BSON.ObjectId(),
      _partition: data.outlet.toString(),
      title: data.title,
      active: data.active,
      user_id: BSON.ObjectId(user._id.toString()),
      license: BSON.ObjectId(user.license.toString()),
      outlet: BSON.ObjectId(data.outlet.toString()),
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user._id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    const voidReasons = await db
      .collection(collectionNames.void_reasons)
      .insertOne(dataReason);
    return voidReasons.insertedId;
  };

  const updateReason = async (data) => {
    if (data.outlet) {
      data.outlet = BSON.ObjectId(data.outlet.toString());
    }

    const dataUpdate = {
      ...data,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    delete dataUpdate.id;

    await db.collection(collectionNames.void_reasons).updateOne(
      {
        _id: BSON.ObjectId(data.id.toString()), // need license
        license: user.license,
      },
      {
        $set: { ...dataUpdate },
      },
      {
        upsert: false,
      }
    );

    return data.id;
  };

  const insertVoidReason = async () => {
    const { data } = payload;

    if (!data.id) {
      return createReason(data);
    } else {
      return updateReason(data);
    }
  };

  /*
    exports({
      method: 'POST',
      filter: {},
      data: {
        id:'603363e1e77619ad4fe73438', // id optional hanya untuk update
        title: 'reason update',
        outlet: '602c8d681509d0b81c63ead8',
        active: true
      }
    })      
  */

  const POST = async () => {
    await postValidation();

    const reason_id = await insertVoidReason();

    return reason_id.toString();
  };

  const updateActive = async () => {
    const { data, filter } = payload;

    const dataUpdate = {
      active: data.active,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    return db.collection(collectionNames.void_reasons).findOneAndUpdate(
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

  /* 
      exports({
      method:'ACTIVE',
      filter:{},
      data:{
        id: '600e74ebe4442131b16bc136',
        active: true,
      }
    })
  */

  const activeValidate = async () => {
    const { data, filter } = payload;

    await valid.hasPermission("bo_utility");

    if (filter.outlet_id) {
      filter.outlet = BSON.ObjectId(filter.outlet_id.toString());
    }

    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(filter, "outlet", "E20033BE", true);
    valid.isObjValid(filter, "id", "E20106BE", true);

    filter._id = BSON.ObjectId(filter.id.toString());
    filter.license = BSON.ObjectId(user.license.toString());

    delete filter.outlet_id;
    delete filter.id;
  };

  const ACTIVE = async () => {
    // validate request
    await activeValidate();

    const findReason = await updateActive();

    if (!findReason) {
      throw new Error("E30079BE");
    }

    return findReason._id.toString();
  };

  return Object.freeze({ LIST, ACTIVE, POST });
};
