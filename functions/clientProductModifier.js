exports = async (payload) => {
  try {
    const productModifierObject = await productModifier(payload);
    const { method } = payload;

    if (productModifierObject[method]) {
      return await productModifierObject[method]();
    } else {
      return true;
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientProductModifier"
    );
  }
};

const productModifier = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { product_departments, product_modifiers } =
    context.values.get("COLLECTION_NAMES");
  const { _id, license } = context.functions.execute("intUserContext");

  /*
      method: 'ACTIVE',
      filter: {
        outlet_id: '6254e41d3a06641d8e8534ef',
        id: '625539423a06641d8e93727a',
      },
      data: {
        active: false
      }
    })
  */

  const ACTIVE = async () => {
    // validation product modifier
    await ACTIVEValidation();

    // update active db
    return dbUpdateActive();
  };

  const ACTIVEValidation = async () => {
    const { data, filter } = payload;

    if (filter.outlet_id) {
      filter.outlet = filter.outlet_id.toString();
    }

    await valid.hasPermission("bo_product");
    valid.isObjValid(filter, "outlet", "E20033BE", true);
    valid.isObjValid(filter, "id", "E20106BE", true);
    valid.isObjValid(data, "active", "E20081BE", true);
  };

  const dbUpdateActive = async () => {
    const {
      data: { active },
      filter: { outlet, id },
    } = payload;

    await db.collection(product_modifiers).updateOne(
      {
        license,
        outlet: BSON.ObjectId(outlet.toString()),
        _id: BSON.ObjectId(id.toString()),
      },
      {
        $set: {
          active: active,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(_id.toString()),
        },
        $inc: { __v: 1 },
      }
    );

    return id;
  };

  /*
    exports({
      "method":"LIST",
      "data":null,
      "filter":{
        "business_id":"60f7d7fc3d23408ed63317a3",
        "outlet_id":""
      }
    })
  */

  const LIST = async () => {
    const { filter } = payload;

    // required business_id
    if (!filter.business_id) {
      throw new Error("E20110BE");
    }

    filter.license = BSON.ObjectId(license.toString());

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

    const productModifierList = await db
      .collection(product_modifiers)
      .aggregate([
        {
          $match: {
            ...payload.filter,
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
            from: "product_departments",
            let: { departments: "$departments" },
            pipeline: [
              {
                $match: { $expr: { $in: ["$_id", "$$departments"] } },
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                },
              },
            ],
            as: "departments",
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            departments: { _id: 1, name: 1 },
            outlet: { _id: 1, name: 1 },
            active: 1,
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();

    return productModifierList.map((obj) => {
      const { _id: modifier_id, name, outlet, departments, active } = obj;

      return {
        id: modifier_id.toString(),
        name,
        departments: departments.map((v) => {
          return {
            id: v._id.toString(),
            name: v.name,
          };
        }),
        outlet_id: outlet._id.toString(),
        outlet_name: outlet.name,
        active,
      };
    });
  };

  /*
    exports({
    method: 'POST',
    data: {
      id: "",
      name: "toping terang",
      outlet: "60f7d7fc3d23408ed63317a2",
      active: true,
      departments:[
        '60f8f5c9140f91c4908c9ef8',
        '60f8f5c93d23408ed64c5da7'
      ],
      active:true
    }
  })
  */

  const POST = async () => {
    // 1. validation
    await POSTValidate();

    // 2. save new or update modifier
    return saveModifier();
  };

  const POSTValidate = async () => {
    const { data } = payload;

    // check permission
    await valid.hasPermission("bo_product");
    if (!data.id || data.id == "") {
      // checking existing department
      const departments_id = data.departments.map((item) =>
        BSON.ObjectId(item)
      );

      const find_departments = await db
        .collection(product_departments)
        .find({
          _id: { $in: departments_id },
          license,
        })
        .toArray();

      if (departments_id.length !== find_departments.length) {
        throw new Error("E30049BE");
      }
    }

    if (data.name && data.name.length > 30) {
      throw new Error("E20014BE");
    }

    valid.isObjValid(data, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "name", "E20105BE", true);
    valid.isObjValid(data, "id", "E20106BE", false);
    valid.isObjValid(data, "active", "E20081BE", true);
    valid.isObjValid(data, "departments", "E20070BE", true);

    await valid.isUnique(data, product_modifiers, "name", "E30069BE");
  };

  const saveModifier = async () => {
    const { data } = payload;
    // covert string to ObjectId
    const departments = data.departments.map((id) => {
      return BSON.ObjectId(id.toString());
    });
    const outlet = BSON.ObjectId(data.outlet_id.toString());

    if (data.id) {
      await db.collection(product_modifiers).updateOne(
        {
          _id: BSON.ObjectId(data.id.toString()), // need license
          license,
        },
        {
          $set: {
            ...data,
            outlet,
            departments,
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(_id.toString()),
          },
          $inc: { __v: 1 },
        }
      );

      return data.id;
    } else {
      delete data.id;
      return (
        await db.collection(product_modifiers).insertOne({
          _id: new BSON.ObjectId(),
          __v: 0,
          _partition: data.outlet_id.toString(),
          createAt: new Date(),
          updatedAt: new Date(),
          createdBy: BSON.ObjectId(_id.toString()),
          updatedBy: BSON.ObjectId(_id.toString()),
          license,
          ...data,
          outlet,
          departments,
        })
      ).insertedId.toString();
    }
  };

  return Object.freeze({ POST, LIST, ACTIVE });
};
