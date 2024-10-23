exports = async (e, payload, source = "", user) => {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { name, _id } = context.functions.execute("intUserContext");

  let langRequested = "en";
  if (payload?.headers) {
    langRequested = payload.headers.Lang ? payload.headers.Lang : "en";
    if (Array.isArray(langRequested)) {
      langRequested = langRequested[0] || "en";
    }
  }

  const errorMessages = context.values.get("ERROR_MESSAGES");
  let errorCode = e.message.match(/E\d{5}BE/gi);
  let errorMessage = e.message;

  if (!errorCode) {
    errorCode = "E40001BE";
    await BuildSendError();
  } else {
    errorCode = errorCode[0];
  }
  errorMessage = errorMessages[errorCode][langRequested] || e.message;
  return {
    status: false,
    message: errorMessage,
    data: null,
    error: errorCode,
  };

  // <- Internal Functions ->
  async function BuildSendError() {
    let userAndId = user || _id ? `${name} | ${_id}` : "-";

    if (!userAndId && payload.query) {
      userAndId = await getUserAndId();
    }

    if (payload?.body) {
      payload.body = EJSON.parse(payload.body?.text() || {});
    }
    payload = JSON.stringify(payload || "");

    const newLog = {
      _id: BSON.ObjectId(),
      thread_key: "realm-bo",
      isCatchError: true,
      error_message: e.message ? e.message : e,
      env: context.environment.tag || "",
      appId: context.app.clientAppId || "",
      version: context.values.get("VERSION")?.version || "-",
      outlet: await getOutletAndBusiness(),
      userAndId: userAndId,
      source: source,
      payload: payload,
    };

    const dbLog = mongodb.db("ErrorLog");
    await dbLog.collection("error_log").insertOne(newLog);
  }

  async function getOutletAndBusiness() {
    try {
      const outlet_id =
        payload?.filter?.outlet_id || payload?.data?.outlet_id || null;

      if (!outlet_id) {
        return "-";
      }

      let outlet = await db
        .collection(collectionNames.outlet)
        .aggregate([
          {
            $match: {
              _id: BSON.ObjectId(outlet_id.toString()),
            },
          },
          {
            $lookup: {
              from: "user_business",
              let: { business_id: ["$business_id"] },
              pipeline: [
                {
                  $match: { $expr: { $in: ["$_id", "$$business_id"] } },
                },
                {
                  $project: { _id: 0, name: 1 },
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
              id: { $toString: "$_id" },
              name: 1,
              business_name: "$business.name",
            },
          },
        ])
        .toArray();

      if (outlet?.length == 0) {
        return "-";
      }

      outlet = outlet[0];

      return `${outlet.business_name} | ${outlet.name}(${outlet.id})`;
    } catch (e) {
      return "-";
    }
  }

  async function getUserAndId() {
    try {
      if (!payload.query?.data) {
        return "-";
      }

      const email = Buffer.from(payload.query.data, "base64").toString("utf8");

      const user = await db.collection(collectionNames.user).findOne(
        {
          email: email,
        },
        {
          fullname: 1,
        }
      );

      return user ? `${user.fullname} | ${user._id?.toString()}` : "-";
    } catch (e) {
      return "-";
    }
  }
};
