module.exports = async (payload) => {
  try {
    const generalSetting = generalFunction(payload);

    const { method } = payload;
    if (generalSetting[method]) {
      return await generalSetting[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientGeneralSetting"
    );
  }
};

const generalFunction = (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { general } = context.values.get("COLLECTION_NAMES");

  const { license, _id: user_id } = context.functions.execute("intUserContext");

  /*
      exports({
        "method":"GET",
        "data":{},
        "filter":{
          outlet_id: '619f46f9a6c89fd61832826e'
        },
      })
    */

  const GET = async () => {
    getFilterAndValidation();

    const settings = await getGeneralSettings();

    if (settings.length == 0) {
      throw new Error("E30094BE");
    }

    return getReturnFormat(settings);
  };
  /*
    exports({
      method: "POST",
      filter: {
        outlet_id: "619f46f9a6c89fd61832826e",
      },
      data: {
        general_settings: [
          {
            id: "619f46f9a6c89fd61832828f", //id general
            value: false,
          },
        ],
      },
    })
  */
  const POST = async () => {
    postFilterAndValidation();

    const settings = await buildPostData();

    if (settings.length > 0) {
      await updateGeneralSetting(settings);
    }

    return true;
  };

  const updateGeneralSetting = async (settings) => {
    try {
      return db.collection(general).bulkWrite(settings);
    } catch (e) {
      throw new Error(e);
    }
  };

  const getOldData = async () => {
    const { filter } = payload;

    return db
      .collection(general)
      .aggregate([
        { $match: filter },
        {
          $project: {
            type: 1,
            value: 1,
          },
        },
      ])
      .toArray();
  };

  const buildPostData = async () => {
    let { data } = payload;

    const oldData = await getOldData();

    return data.general_settings.reduce((prev, setting) => {
      const findSetting = oldData.find((each) => {
        return each._id == setting.id;
      });

      if (!findSetting) throw new Error("E30094BE");

      if (findSetting.type == "boolean") {
        if (!["true", "false", false, true].includes(setting.value)) {
          throw new Error("wrong general setting value ");
        } else {
          setting.value = setting.value.toString();
        }
      }

      if (findSetting.value != setting.value) {
        return [
          ...prev,
          {
            updateOne: {
              filter: {
                _id: BSON.ObjectId(setting.id.toString()),
                license,
              },
              update: {
                $set: {
                  value: setting.value,
                  updatedAt: new Date(),
                  updatedBy: BSON.ObjectId(user_id),
                },
              },
            },
          },
        ];
      }

      return prev;
    }, []);
  };

  const postFilterAndValidation = () => {
    let { filter, data } = payload;

    valid.isObjValid(filter, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "general_settings", "E20166BE", true);

    data.general_settings.forEach((setting) => {
      valid.isObjValid(setting, "id", "E20167BE", true);
      valid.isObjValid(setting, "value", "E20168BE", true);
    });

    filter.license = license;
    filter.outlet = BSON.ObjectId(payload.filter.outlet_id.toString());

    delete filter.outlet_id;
  };

  const getReturnFormat = (settings) => {
    return settings.map((setting) => {
      if (setting.type.toString() === "boolean") {
        if (setting.value == "true") {
          setting.value = true;
        } else {
          setting.value = false;
        }
      }

      return {
        id: setting._id.toString(),
        name: setting.name,
        value: setting.value,
      };
    });
  };

  const getGeneralSettings = async () => {
    const { filter } = payload;
    return db
      .collection(general)
      .aggregate([
        { $match: filter },
        {
          $project: {
            name: 1,
            type: 1,
            value: 1,
            pos_editable: 1,
          },
        },
      ])
      .toArray();
  };

  const getFilterAndValidation = async () => {
    let { filter } = payload;

    valid.isObjValid(filter, "outlet_id", "E20033BE", true);

    filter.license = license;
    filter.active = true;
    // di design Konfigurasi yang di tmapilkan hanya setting yang bertipe boolean
    filter.type = "boolean";
    filter.outlet = BSON.ObjectId(payload.filter.outlet_id.toString());

    delete filter.outlet_id;
  };

  return Object.freeze({ GET, POST });
};
