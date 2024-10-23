exports = async (payload) => {
  try {
    const generalObject = generalFunction(payload);

    const { method } = payload;
    if (generalObject[method]) {
      return await generalObject[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientReportDefaultFilter"
    );
  }
};

const generalFunction = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  /*
        exports({
          method: "GET",
          filter: {
            time_offset: -7, //required
            outlet_id: "6156606885345c6e13961070", //optional
          },
          data: {},
        })
    */

  const GET = async () => {
    await getValidation();

    const getBuildDate = await buildDateFilter();

    return getBuildDate;
  };

  const getValidation = async () => {
    const { filter } = payload;
    if (!filter) throw new Error("E20037BE");

    // validation
    valid.isRequired(filter, "time_offset", "E20211BE");

    //check apakah outlet ada di DB
    if (filter.outlet_id) {
      await valid.isDataExists(
        collectionNames.outlet,
        {
          _id: BSON.ObjectId(filter.outlet_id.toString()),
          license: BSON.ObjectId(user.license.toString()),
        },
        "E30032BE"
      );
    }
  };

  const buildDateFilter = async () => {
    const { filter } = payload;
    const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
    let end_date = new Date(
      new Date(new Date().setDate(new Date().getDate())).setUTCHours(
        23 - Math.abs(filter.time_offset || 7),
        59,
        59,
        999
      )
    );

    let start_date = new Date(
      new Date(today.getFullYear(), today.getMonth(), 1).setUTCHours(
        0 - Math.abs(filter.time_offset || 7),
        0,
        0,
        0
      )
    );

    if (end_date.getUTCDate().toString() == "1") {
      start_date = new Date(end_date.setMonth(end_date.getMonth() - 1));
    }

    if (filter.outlet_id) {
      const findOpenCloseTime = await getOpenCloseTimeOutlet();
      const open_time = findOpenCloseTime[0].open_time;
      const close_time = findOpenCloseTime[0].close_time;

      start_date = new Date(
        new Date(today.getFullYear(), today.getMonth(), 1).setHours(
          open_time.getHours(),
          open_time.getMinutes(),
          open_time.getSeconds()
        )
      );
      end_date.setHours(
        close_time.getHours(),
        close_time.getMinutes(),
        close_time.getSeconds()
      );
    }

    return {
      start_date,
      end_date,
    };
  };

  const getOpenCloseTimeOutlet = async () => {
    const { filter } = payload;
    return db
      .collection(collectionNames.outlet)
      .find(
        {
          _id: BSON.ObjectId(filter.outlet_id.toString()),
          license: BSON.ObjectId(user.license.toString()),
        },
        { _id: 1, open_time: 1, close_time: 1 }
      )
      .toArray();
  };

  return Object.freeze({ GET });
};
