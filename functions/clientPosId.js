exports = async (payload) => {
  try {
    const posIdObject = await posId(payload);
    if (posIdObject[payload.method]) {
      return await posIdObject[payload.method]();
    }
    throw new Error("Method not found in request");
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientPosId"
    );
  }
};

const posId = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
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
        "business_id":"611e1583f7bf5674c1785823",
        "outlet_id":"611e1583f7bf5674c1785822"
      }
    })

    1. check ACL
    2. fetch POSID
    3. format response
  */
  const LIST = async () => {
    // 1. check ACL
    await valid.hasPermission(["bo_outlet"]);

    await LISTValidation();

    // 2. fetch POSID
    const POSIDs = await dbLISTFetchPosID();

    // 3. format response
    return LISTFormatReturn(POSIDs);
  };

  /*
    exports({
      method: 'POST',
      filter: {},
      data: {
          id: '60093dec403325defdbe246d',
          outlet_id: '6006ae725009e65423513de4',
          name: 'order update',
          active: true
      }
    })
  */
  const POST = async () => {
    const { data } = payload;

    await POSTValidation();

    if (!data.id) {
      // 1. insert pos_id
      const newPOSID = (await dbPOSTCreateNew()).insertedId;

      // 2. update outlet
      await dbPOSTUpdateOutlet(newPOSID);

      return newPOSID.toString();
    } else {
      // 1. update pos id
      await dbPOSTUpdatePOSID();

      return data.id;
    }
  };
  // ================ MAIN method end   ========================

  // ================ Helper function start   ==================
  const LISTValidation = async () => {
    const { filter } = payload;

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

  const LISTFormatReturn = (data) => {
    return data.reduce((prev, curr) => {
      curr.outlet_id = curr._id.toString();
      curr.outlet_name = curr.name;
      curr.business_id = curr.business_id.toString();
      delete curr._id;
      delete curr.name;
      delete curr.lowerName;

      curr.list_pos_id = curr.list_pos_id.map((v) => {
        v.id = v._id.toString();
        v.online_status = false;
        delete v._id;

        if (v.user_device) {
          v.user_device = {
            id: v.user_device._id.toString(),
            serial_number: v.user_device.serialNumber,
            imei: v.user_device.imei,
            last_online: v.user_device.lastOnline,
          };

          const delta = Math.abs(
            (new Date() - v.user_device.last_online) / 36e5
          );
          if (delta < 8) {
            v.online_status = true;
          }
        }

        return v;
      });

      return [...prev, curr];
    }, []);
  };

  const POSTValidation = async () => {
    const { data } = payload;

    // validation request
    valid.isObjValid(data, "name", "E20065BE", true);
    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(data, "outlet_id", "E20033BE", true);

    await valid.hasPermission(["bo_outlet"]);

    // validation outlet exist
    await valid.isDataExists(
      collectionNames.outlet,
      {
        _id: BSON.ObjectId(data.outlet_id.toString()),
        license: BSON.ObjectId(user.license.toString()),
      },
      "E30032BE"
    );

    if (data.id) {
      await valid.isDataExists(
        collectionNames.pos_ids,
        {
          _id: BSON.ObjectId(data.id.toString()),
          // validasi outlet berbeda ada di function dbPOSTValidateOutlet
          // outlet: BSON.ObjectId(data.outlet_id.toString()),
        },
        "E30031BE"
      );
    }

    await valid.isUnique(data, collectionNames.pos_ids, "name", "E30030BE");
    await dbPOSTValidateOutlet();
  };
  // ================ Helper function end     ==================

  // ================ DB function start ========================
  const dbLISTFetchPosID = () => {
    return db
      .collection(collectionNames.outlet)
      .aggregate([
        {
          $match: {
            _id: payload.filter.outlet,
            license: payload.filter.license,
          },
        },
        {
          $lookup: {
            from: "pos_ids",
            let: { outlet_id: "$_id" },
            pipeline: [
              {
                $match: { $expr: { $eq: ["$outlet", "$$outlet_id"] } },
              },
              {
                $lookup: {
                  from: "user_device",
                  localField: "_id",
                  foreignField: "posId",
                  as: "user_device",
                },
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  active: 1,
                  user_device: {
                    _id: 1,
                    serialNumber: 1,
                    imei: 1,
                    lastOnline: 1,
                  },
                },
              },
              {
                $unwind: {
                  path: "$user_device",
                  preserveNullAndEmptyArrays: true,
                },
              },
            ],
            as: "list_pos_id",
          },
        },
        { $unwind: "$list_pos_id" },
        { $sort: { "list_pos_id.updatedAt": -1 } },
        {
          $group: {
            _id: { id: "$_id", name: "$name", business_id: "$business_id" },
            list_pos_id: {
              $push: "$list_pos_id",
            },
          },
        },
        {
          $project: {
            _id: "$_id.id",
            name: "$_id.name",
            list_pos_id: 1,
            business_id: "$_id.business_id",
            lowerName: {
              $toLower: "$_id.name",
            },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();
  };

  const dbPOSTCreateNew = () => {
    const { data } = payload;
    const dataPosId = {
      __v: 0,
      _id: new BSON.ObjectId(),
      _partition: data.outlet_id.toString(),
      active: data.active,
      outlet: BSON.ObjectId(data.outlet_id),
      license: user.license,
      user_id: BSON.ObjectId(user._id),
      name: data.name,
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user._id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    return db.collection(collectionNames.pos_ids).insertOne(dataPosId);
  };

  const dbPOSTUpdateOutlet = (pos_id) => {
    const { data } = payload;
    // tidak perlu mengisi updatedAt, __v, dan updatedBy
    // karena update ini tujuanya untuk memasukkan otomatis pos_id ke outlet
    // bukan update manual by user
    return db.collection(collectionNames.outlet).updateOne(
      {
        _id: BSON.ObjectId(data.outlet_id),
        license: user.license,
      },
      {
        $push: { pos: pos_id },
      }
    );
  };

  const dbPOSTUpdatePOSID = async () => {
    const { data } = payload;
    const dataUpdate = {
      name: data.name,
      active: data.active,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id.toString()),
    };

    await db.collection(collectionNames.pos_ids).updateOne(
      {
        _id: BSON.ObjectId(data.id.toString()),
        license: user.license,
      },
      {
        $set: { ...dataUpdate },
        $inc: { __v: 1 },
      }
    );
  };

  const dbPOSTValidateOutlet = async () => {
    const { data } = payload;
    if (data.id) {
      const { outlet } = await db.collection(collectionNames.pos_ids).findOne(
        {
          _id: BSON.ObjectId(data.id.toString()),
          license: user.license,
        },
        { outlet: 1 }
      );

      if (outlet.toString() != data.outlet_id) {
        throw new Error("E30011BE");
      }
    }
  };
  // ================ DB function end   ========================

  const ACTIVE = async () => {
    /*
      exports({
      method:'ACTIVE',
      filter:{},
      data:{
        id: '600e74ebe4442131b16bc136',
        active: true,
        outlet: *outlet_id*
      }
    })
    */
    /* -------- active and deactive data ------------
      - validate request
      - validate key outlet exist
      - update active true or false status
    */

    const { data } = payload;

    // validate request
    valid.isObjValid(data, "active", "E20062BE", true);

    const dataUpdate = {
      active: data.active,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    await db.collection(collectionNames.pos_ids).updateOne(
      {
        _id: BSON.ObjectId(data.id.toString()),
        license: BSON.ObjectId(user.license.toString()),
      },
      {
        $set: { ...dataUpdate },
        $inc: { __v: 1 },
      }
    );

    return true;
  };

  const getDetailFromPosId = () => {
    const { filter } = payload;

    return db
      .collection(collectionNames.pos_ids)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: collectionNames.outlet,
            localField: "outlet",
            foreignField: "_id",
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
            from: collectionNames.user_business,
            localField: "outlet.business_id",
            foreignField: "_id",
            as: "business",
          },
        },
        {
          $unwind: {
            path: "$business",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: collectionNames.user_device,
            localField: "_id",
            foreignField: "posId",
            as: "user_device",
          },
        },
        {
          $unwind: {
            path: "$user_device",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: collectionNames.user,
            localField: "user_device.updatedBy",
            foreignField: "_id",
            as: "sign_user",
          },
        },
        {
          $unwind: {
            path: "$sign_user",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: collectionNames.user,
            localField: "user_device.user_id",
            foreignField: "_id",
            as: "login_user",
          },
        },
        {
          $unwind: {
            path: "$login_user",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            name: 1,
            outlet: { name: 1 },
            business: {
              name: 1,
            },
            login_user: {
              fullname: 1,
              type: 1,
            },
            user_device: {
              serialNumber: 1,
            },
            sign_user: {
              fullname: 1,
              type: 1,
            },
          },
        },
      ])
      .toArray();
  };

  const posIdFormatReturn = async () => {
    let data = await getDetailFromPosId();

    if (data.length == 0) {
      return null;
    }

    data = data[0];

    return {
      id: data._id,
      posIdName: data.name,
      outletName: data.outlet.name,
      businessName: data.business.name,
      serialNumber: data.user_device ? data.user_device.serialNumber : null,
      signUser: data.sign_user ? data.sign_user : null,
      loginUser: data.login_user ? data.login_user : null,
    };
  };

  const valiedatedGetPosId = () => {
    const { filter } = payload;

    if (!filter.id) throw new Error("E20092BE");

    filter._id = BSON.ObjectId(filter.id);
    filter.license = user.license;
    delete filter.id;
  };

  const GET = async () => {
    valiedatedGetPosId();

    return posIdFormatReturn();
  };

  /*
    exports({
      method: 'LITE',
      filter: {},
      data: {}
    })
  */

  const LITE = async () => {
    await filterAndValidation();

    return dbFetchPosIds();
  };

  const filterAndValidation = async () => {
    await valid.hasPermission(["bo_outlet"]);

    payload.filter.license = BSON.ObjectId(user.license.toString());
  };

  const dbFetchPosIds = async () => {
    const posids = await db
      .collection(collectionNames.pos_ids)
      .aggregate([
        {
          $match: { ...payload.filter, license_device_id: { $exists: false } },
        },
        {
          $lookup: {
            from: collectionNames.outlet,
            localField: "outlet",
            foreignField: "_id",
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
            from: collectionNames.user_business,
            localField: "outlet.business_id",
            foreignField: "_id",
            as: "business",
          },
        },
        {
          $unwind: {
            path: "$business",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            name: 1,
            outlet: { _id: 1, name: 1 },
            business: { _id: 1, name: 1 },
          },
        },
      ])
      .toArray();

    return posids.map((posid) => {
      const {
        _id,
        name,
        outlet: { _id: outlet_id, name: outlet_name },
        business: { _id: business_id, name: business_name },
      } = posid;
      return {
        id: _id.toString(),
        name,
        outlet_id: outlet_id.toString(),
        outlet_name,
        business_id: business_id.toString(),
        business_name,
      };
    });
  };

  return Object.freeze({ LIST, POST, ACTIVE, GET, LITE });
};
