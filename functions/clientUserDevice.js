exports = async (payload) => {
  try {
    const userDeviceObject = await userDevice(payload);

    const { method } = payload;
    if (userDeviceObject[method]) {
      return await userDeviceObject[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientUserDevice"
    );
  }
};

const userDevice = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { license } = context.functions.execute("intUserContext");

  /*
  exports({
    method: "LOGOUT",
    filter: { pos_id: "6156608162f9555a14686cf2" },
    data: {},
  })
  */

  const LOGOUT = async () => {
    await logoutValidate();

    const device = await removeUserDevice();

    if (!device && !payload.ignorefindDevice)
      return { id: "", device_name: "" };

    // flag ignorefindDevice di gunakan di saat uninstall posid
    if (payload.ignorefindDevice) {
      return true;
    } else {
      return {
        id: device._id.toString(),
        device_name: device.device_name ? device.device_name : "",
      };
    }
  };

  const logoutValidate = async () => {
    const { filter } = payload;

    await valid.hasPermission(["bo_account_settings"]);

    valid.isObjValid(filter, "pos_id", "E20034BE", true);

    filter.license = BSON.ObjectId(license.toString());
    filter.posId = BSON.ObjectId(filter.pos_id.toString());

    delete filter.pos_id;
  };

  const removeUserDevice = () => {
    return db
      .collection(collectionNames.user_device)
      .findOneAndDelete(payload.filter);
  };

  return Object.freeze({ LOGOUT });
};
