exports = async (payload) => {
  try {
    const licenseDeviceObject = await licenseDevice(payload);

    const { method } = payload;
    if (licenseDeviceObject[method]) {
      return await licenseDeviceObject[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientUserLicenseDevice"
    );
  }
};

const licenseDevice = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { license, _id: user_id } = context.functions.execute("intUserContext");

  // ================ MAIN method start ========================

  /*
    exports(
      {
        method: 'LIST',
        filter: {},
        data: {},
      }
    )
  */
  const LIST = async () => {
    await LISTValidation();

    const license_devices = await dbLISTGetUserLicenseDevices();

    return LISTReturnFormat(license_devices);
  };
  /*
    exports(
      {
        method: 'LITE',
        filter: {},
        data: {},
      }
    )
  */

  const LITE = async () => {
    await LITEValidation();

    return LITEReturnFormat();
  };
  /*
    exports(
     {
			 method:"INSTALL",
			 data:{
				 pos_id: string | required
				},
			 filter:{
				 license_id: string | required
				}
			}
    )
  */

  const INSTALL = async () => {
    await INSTALLValidation();

    return dbINSTALLDeviceLicense();
  };

  /*
    exports(
     {
			 method:"UNINSTALL",
			 data:{
				 pos_id: string | required
				},
			 filter:{
				 license_id: string | required
				}
			}
    )
  */

  const UNINSTALL = async () => {
    await UNINSTALLValidation();

    return dbUNINSTALLDeviceLicense();
  };

  // ================ MAIN method end ========================

  // ================ Helper function start ==================

  const LISTValidation = async () => {
    await valid.hasPermission(["bo_outlet"]);

    payload.filter.license = BSON.ObjectId(license.toString());
  };

  const LISTReturnFormat = (licenseDevices) => {
    return licenseDevices.map((v) => {
      const {
        _id: license_id,
        license_label,
        expired,
        outlet,
        pos_id,
        business,
        device_name,
      } = v;
      return {
        license_id: license_id.toString(),
        license_label,
        expired,
        device_name: device_name || "",
        outlet_id: pos_id ? outlet._id.toString() : "",
        outlet_name: pos_id ? outlet.name.toString() : "",
        business_id: pos_id ? business._id.toString() : "",
        business_name: pos_id ? business.name.toString() : "",
        pos_id: pos_id ? pos_id._id.toString() : "",
        pos_name: pos_id ? pos_id.name : "",
        used: pos_id ? true : false,
      };
    });
  };

  const LITEValidation = async () => {
    payload.filter.license = BSON.ObjectId(license.toString());
  };

  const LITEReturnFormat = async () => {
    const licensedevices = await dbLITEGetUserLicenseDevices();
    return licensedevices.map((v) => {
      return {
        id: v._id.toString(),
        name: v.license_label,
      };
    });
  };

  const INSTALLValidation = async () => {
    await InstallAndUninstallValidation();
    await dbCHECKUserLicense();
  };

  const UNINSTALLValidation = async () => {
    await InstallAndUninstallValidation();
    await dbCHECKUserDevice();
  };

  const InstallAndUninstallValidation = async () => {
    const { data, filter } = payload;
    valid.isObjValid(filter, "license_id", "E20148BE", true);
    valid.isObjValid(data, "pos_id", "E20034BE", true);

    filter.license = BSON.ObjectId(license.toString());
    filter._id = BSON.ObjectId(filter.license_id.toString());

    data.pos_id = BSON.ObjectId(data.pos_id.toString());

    const posidOutlet = await db
      .collection(collectionNames.pos_ids)
      .findOne({ license: filter.license, _id: data.pos_id }, { outlet: 1 });

    if (!posidOutlet) throw new Error("E30031BE");

    data.outlet = posidOutlet.outlet;

    delete filter.license_id;
  };

  // ================ Helper function end ====================

  // ================ DB function start ====================

  const dbLISTGetUserLicenseDevices = () => {
    const { filter } = payload;

    return db
      .collection(collectionNames.user_license_device)
      .aggregate([
        {
          $match: {
            ...filter,
          },
        },
        {
          $project: {
            pos_id: 1,
            license_label: 1,
            expired: 1,
          },
        },
        {
          $lookup: {
            from: "pos_ids",

            let: {
              id: "$pos_id",
            },
            pipeline: [
              {
                $match: {
                  _id: "$$id",
                },
              },
              {
                $project: {
                  name: 1,
                  outlet: 1,
                },
              },
            ],
            as: "pos_id",
          },
        },
        {
          $unwind: {
            path: "$pos_id",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "user_device",
            let: { pos_id: "$pos_id" },
            pipeline: [
              {
                $match: {
                  // catatan, jika ingin memastikan field ada isinya , gunakan exist & not equal null
                  // karena sekarang data direalm bisa terima value null
                  // case di sini sebelumnya hanya menggunakan exist true dan key(pos_id)nya sama2 null
                  // maka yang di return data dengan pos_id null (harusnya data dengan pos_id yang sama)
                  $and: [
                    {
                      posId: { $exists: true },
                    },
                    {
                      posId: { $ne: null },
                    },
                  ],
                  $expr: {
                    $eq: ["$posId", "$$pos_id._id"],
                  },
                },
              },
              {
                $project: {
                  device_name: 1,
                },
              },
            ],
            as: "device",
          },
        },
        {
          $unwind: {
            path: "$device",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "outlet",
            let: { id: "$pos_id.outlet" },
            pipeline: [
              {
                $match: {
                  _id: "$$id",
                },
              },
              {
                $lookup: {
                  from: collectionNames.user_business,
                  let: { business_id: "$business_id" },
                  pipeline: [
                    {
                      $match: {
                        _id: "$$business_id",
                      },
                    },
                    {
                      $project: {
                        name: 1,
                      },
                    },
                  ],
                  as: "business",
                },
              },
              {
                $unwind: "$business",
              },
              {
                $project: {
                  name: 1,
                  business: 1,
                },
              },
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
          $project: {
            license_label: 1,
            expired: 1,
            outlet: {
              _id: 1,
              name: 1,
            },
            business: "$outlet.business",
            pos_id: {
              _id: 1,
              name: 1,
            },
            device_name: "$device.device_name",
            lowerLabel: {
              $toLower: "$license_label",
            },
          },
        },
        { $sort: { lowerLabel: 1 } },
      ])
      .toArray();
  };

  const dbLITEGetUserLicenseDevices = () => {
    const { filter } = payload;

    return db
      .collection(collectionNames.user_license_device)
      .find({ ...filter }, { _id: 1, license_label: 1 })
      .toArray();
  };

  const dbUPDATEPosID = (device_id) => {
    const { filter, data } = payload;
    filter._id = data.pos_id;

    return db.collection(collectionNames.pos_ids).findOneAndUpdate(
      {
        ...filter,
      },
      {
        $set: {
          license_device_id: device_id,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user_id),
        },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1 },
      }
    );
  };

  const dbINSTALLDeviceLicense = async () => {
    const { data, filter } = payload;

    const licenseid = await db
      .collection(collectionNames.user_license_device)
      .findOneAndUpdate(
        { ...filter },
        {
          $set: {
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user_id),
            pos_id: data.pos_id,
            outlet: data.outlet,
          },
          $inc: { __v: 1 },
        },
        {
          projection: { _id: 1 },
        }
      );

    if (!licenseid) throw new Error("E30082BE");

    const posid = await dbUPDATEPosID(licenseid._id);

    if (!posid) throw new Error("E30031BE");

    return licenseid._id.toString();
  };

  const dbCHECKUserLicense = async () => {
    const { data, filter } = payload;

    const checkUserLicense = await db
      .collection(collectionNames.user_license_device)
      .findOne({ license: filter.license, pos_id: data.pos_id }, { _id: 1 });

    if (checkUserLicense) throw new Error("E30043BE");
  };

  const dbUNINSTALLDeviceLicense = async () => {
    const { filter } = payload;

    const licenseid = await db
      .collection(collectionNames.user_license_device)
      .findOneAndUpdate(
        { ...filter },
        {
          $set: {
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user_id),
          },
          $unset: {
            pos_id: "",
          },
          $inc: { __v: 1 },
        },
        {
          projection: { _id: 1 },
        }
      );

    if (!licenseid) throw new Error("E30082BE");

    const posid = await dbREMOVELicenseDevicefromPosId();

    if (!posid) throw new Error("E30031BE");

    context.functions.execute("clientUserDevice", {
      method: "LOGOUT",
      filter: {
        pos_id: posid._id,
      },
      data: {},
      ignorefindDevice: true,
    });

    return licenseid._id.toString();
  };

  const dbCHECKUserDevice = async () => {
    const { data } = payload;

    const checkUserDevice = await db
      .collection(collectionNames.user_device)
      .findOne({ posId: data.pos_id, license }, { _id: 1 });

    if (checkUserDevice) throw new Error("E30104BE");
  };

  const dbREMOVELicenseDevicefromPosId = () => {
    const { filter, data } = payload;
    filter._id = data.pos_id;

    return db.collection(collectionNames.pos_ids).findOneAndUpdate(
      {
        ...filter,
      },
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user_id),
        },
        $unset: {
          license_device_id: "",
        },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1 },
      }
    );
  };

  return Object.freeze({ LIST, LITE, INSTALL, UNINSTALL });
};
