exports = async (payload) => {
  try {
    const userRoleObject = generalFunction(payload);
    switch (payload.method) {
      case "POST":
        return await userRoleObject.saveRole();
      case "LIST":
        return await userRoleObject.listRole();
      case "GET":
        return await userRoleObject.getRole();
      case "ACTIVE":
        return await userRoleObject.ACTIVE();
      default:
        break;
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientUserRole"
    );
  }
};

const userValidation = (user) => {
  if (!user) {
    throw new Error("E10001BE");
  }
};

const generalFunction = (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  userValidation(user);

  const saveRole = async () => {
    /*
      Request :

      {
        method: 'POST',
        data: {
          id: 'roleId'
          active: true | false,
          outlet: 'outlet_id',
          name: 'role_name',
          acl: {...list_of_acl}
        }
      }
    */
    /*
      1. validation
      2. get old data
      3. save ACL
      4. save role
    */

    payload.filter = {
      // default filter
      license: BSON.ObjectId(user.license.toString()),

      // payload filter
      outlet: BSON.ObjectId(payload.data.outlet.toString()),
    };

    if (payload.data.id) {
      payload.filter._id = BSON.ObjectId(payload.data.id.toString());
    }
    delete payload.data.id;
    delete payload.data.outlet;

    // 1. validation
    await validation();

    // 2. get old data
    const oldData = await getOldData();

    // 3. save ACL
    payload.data.acl = await handleACL(oldData);

    // 4. save role
    return handleRole(oldData);
  };

  const validation = async () => {
    // validate ACL
    await valid.hasPermission(["bo_staff"]);

    if (!payload.filter.outlet) throw new Error("E20033BE");
    if (!payload.data.name) throw new Error("E20049BE");
    if (!payload.data.acl) throw new Error("E20048BE");

    // validate ACL list
    const ACLList = context.functions.execute("intTranslatingAcl");

    const ACLDataKeys = Object.keys(payload.data.acl);

    // error sengaja dibuat text, karena ada kesalahan code client
    if (ACLDataKeys.length !== ACLList.length)
      throw new Error("ACL list salah");

    const ACLNotExits = ACLList.reduce((prev, acl) => {
      if (ACLDataKeys.indexOf(acl) === -1) {
        return [...prev, acl];
      } else {
        if (typeof payload.data.acl[acl] !== "boolean") {
          return [...prev, acl];
        }
        return [...prev];
      }
    }, []);

    if (ACLNotExits > 0) {
      // error sengaja dibuat text, karena ada kesalahan code client
      throw new Error(
        `ACL = ${JSON.stringify(ACLNotExits)} tidak ada di dalam request !`
      );
    }
    // validate ACL list ============= end

    // search duplicate name
    const filter = { ...payload.filter, name: payload.data.name };
    if (payload.filter._id) {
      filter._id = { $ne: payload.filter._id };
    }

    const duplicateName = await db
      .collection(collectionNames.user_role)
      .count(filter);
    if (duplicateName > 0) {
      throw new Error("E30020BE");
    }
    // search duplicate name ============= end
  };

  const getOldData = async () => {
    const { filter } = payload;
    if (filter._id) {
      const oldRole = await db
        .collection(collectionNames.user_role)
        .findOne({ ...filter }, { _id: 1, acl: 1 });
      if (!oldRole) throw new Error("E30021BE");

      return oldRole;
    }

    return false;
  };

  const handleACL = async (oldData) => {
    const {
      filter,
      data: { acl },
    } = payload;
    if (oldData) {
      // update ACL
      await db.collection(collectionNames.user_acl).updateOne(
        { ...filter, _id: oldData.acl },
        {
          $set: {
            user_id: BSON.ObjectId(user._id),
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user._id),

            outlet: filter.outlet,
            ...acl,
          },
          $inc: { __v: 1 },
        }
      );

      return oldData.acl;
    } else {
      // new ACL
      const newACL = await db.collection(collectionNames.user_acl).insertOne({
        ...acl,

        _id: new BSON.ObjectId(),
        _partition: filter.outlet.toString(),
        __v: 0,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: BSON.ObjectId(user._id),
        updatedBy: BSON.ObjectId(user._id),
        license: filter.license,
        outlet: filter.outlet,
        user_id: BSON.ObjectId(user._id),
      });

      return newACL.insertedId;
    }
  };

  const handleRole = async (oldData) => {
    const {
      filter,
      data: { active, name, acl },
    } = payload;
    if (oldData) {
      // update role
      await db.collection(collectionNames.user_role).updateOne(
        { ...filter },
        {
          $set: {
            user_id: BSON.ObjectId(user._id),
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user._id),

            outlet: filter.outlet,
            active,
            name,
            acl,
          },
          $inc: { __v: 1 },
        }
      );

      return filter._id.toString();
    } else {
      // insert new role
      const newRole = await db.collection(collectionNames.user_role).insertOne({
        _id: new BSON.ObjectId(),
        _partition: filter.outlet.toString(),
        __v: 0,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: BSON.ObjectId(user._id),
        updatedBy: BSON.ObjectId(user._id),
        license: filter.license,
        outlet: filter.outlet,
        user_id: BSON.ObjectId(user._id),

        name,
        acl,
      });

      return newRole.insertedId.toString();
    }
  };

  const listRole = async () => {
    /*
      exports({
        "method":"LIST",
        "data":null,
        "filter":{
          "business_id":"611e1583f7bf5674c1785823",
          "outlet_id":""
        }
      })
    */

    // validation and filter data
    const { filter } = payload;

    await listValidationAndFilter();

    const userRole = await db
      .collection(collectionNames.user_role)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: "outlet",
            localField: "outlet",
            foreignField: "_id",
            as: "outlet",
          },
        },
        {
          $project: {
            name: 1,
            active: 1,
            outlet: { _id: 1, name: 1 },
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();

    return userRole.map((v) => {
      const {
        _id,
        name,
        active,
        outlet: [{ _id: outlet_id, name: outlet_name }],
      } = v;

      return {
        id: _id.toString(),
        name,
        active,
        outlet_id: outlet_id.toString(),
        outlet_name,
      };
    });
  };

  const listValidationAndFilter = async () => {
    let { filter } = payload;

    // validate ACL tapi tidak perlu throw error
    if (!(await valid.hasPermission(["bo_staff"], false))) {
      return [];
    }

    if (!filter.business_id) {
      throw new Error("E20110BE");
    }

    filter.license = BSON.ObjectId(user.license.toString());

    // execute function intOutletsFromBusiness untuk mecari list outlet dari business_id
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

  /*
    exports({
      method: 'GET',
      filter: {
        id: '61270961fdac9f188f86f982',
        outlet_id: '611e1583f7bf5674c1785822'
      }
    })
  */
  // 1. validate
  // 2. query get role detail
  const getRole = async () => {
    const { filter } = payload;

    // default filter
    filter.license = BSON.ObjectId(user.license.toString());

    // request filter
    filter.outlet = BSON.ObjectId(filter.outlet_id.toString());
    filter._id = BSON.ObjectId(filter.id.toString());
    delete filter.id;
    delete filter.outlet_id;

    // 1. validate
    await validateGetRole();

    // 2. query get role detail
    return await getRoleDetail();
  };

  const validateGetRole = async () => {
    // validate ACL tapi tidak perlu throw error
    if (!(await valid.hasPermission(["bo_staff"], false))) {
      return [];
    }

    const {
      filter: { outlet, _id },
    } = payload;

    if (!outlet) throw new Error("E20033BE");
    if (!_id) throw new Error("E20050BE");
  };

  /*
    exports({
      method: 'GET',
      filter: {
        id: '61270961fdac9f188f86f982',
        outlet_id: '611e1583f7bf5674c1785822'
      }
    })
  */
  const getRoleDetail = async () => {
    const { filter } = payload;

    const userRole = await db
      .collection(collectionNames.user_role)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: "outlet",
            localField: "outlet",
            foreignField: "_id",
            as: "outlet",
          },
        },
        {
          $lookup: {
            from: "user_acl",
            localField: "acl",
            foreignField: "_id",
            as: "acl",
          },
        },
        {
          $project: {
            name: 1,
            active: 1,
            acl: 1,
            outlet: { _id: 1, name: 1 },
          },
        },
      ])
      .toArray();

    return userRole.map((v) => {
      const {
        _id,
        name,
        active,
        acl,
        outlet: [{ _id: outlet_id, name: outlet_name }],
      } = v;

      delete acl[0]._id;
      delete acl[0]._partition;
      delete acl[0].__v;
      delete acl[0].user_id;
      delete acl[0].outlet;
      delete acl[0].license;
      delete acl[0].active;
      delete acl[0].createdAt;
      delete acl[0].updatedAt;
      delete acl[0].createdBy;
      delete acl[0].updatedBy;

      return {
        id: _id.toString(),
        name,
        active,
        outlet_id: outlet_id.toString(),
        outlet_name,
        acl: acl[0],
      };
    });
  };

  const ACTIVE = async () => {
    /*
      Request :

      {
        method: 'ACTIVE',
        data: {
          active: true | false
        },
        filter: {
          id: 'role id'
          outlet_id: 'outlet_id'
        }
      }
    */
    /*
      1. validation
      2. update package status
    */

    // default filter
    payload.filter.license = BSON.ObjectId(user.license.toString());

    // payload filter
    payload.filter.outlet = BSON.ObjectId(payload.filter.outlet_id.toString());
    payload.filter._id = BSON.ObjectId(payload.filter.id.toString());
    delete payload.filter.id;
    delete payload.filter.outlet_id;

    // 1. validation
    await validationStatusRequest();

    // 2. update package status
    const foundRole = await db
      .collection(collectionNames.user_role)
      .findOneAndUpdate(
        { ...payload.filter },
        {
          $set: {
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user._id),

            active: payload.data.active,
          },
        },
        {
          projection: { _id: 1 },
        }
      );

    if (!foundRole) {
      // jika return null, artinya id tidak ditemukan di DB
      throw new Error("E30024BE");
    }

    return payload.filter._id.toString();
  };

  const validationStatusRequest = async () => {
    await valid.hasPermission(["bo_staff"]);
    if (!payload.filter) throw new Error("E20037BE");
    if (!payload.filter.outlet) throw new Error("E20033BE");
    if (!payload.filter._id) throw new Error("E20056BE");
  };

  return Object.freeze({ saveRole, listRole, getRole, ACTIVE });
};
