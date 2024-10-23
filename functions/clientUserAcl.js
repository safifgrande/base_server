module.exports = async (payload) => {
  try {
    const userFunctionObj = await userFunction(payload);
    const { method } = payload;

    if (userFunctionObj[method]) {
      return await userFunctionObj[method]();
    } else {
      return "method not found";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientUserAcl"
    );
  }
};

const userFunction = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { user } = context.values.get("COLLECTION_NAMES");

  const { _id, license } = context.functions.execute("intUserContext");

  /*
    exports({"method":"GET"})
  */
  const GET = async () => {
    // 1. get ACL pattern from realm values
    const ACL = context.values.get("ACL");

    // 2. get user ACL
    const userACL = await dbGETFetchACL();

    // 3. format return data
    return formatReturn(ACL, userACL[0].user_acl);
  };

  // Database query
  const dbGETFetchACL = () => {
    return db
      .collection(user)
      .aggregate([
        {
          $match: {
            license,
            _id: BSON.ObjectId(_id),
          },
        },
        {
          $lookup: {
            as: "user_credentials",
            from: "user_credentials",
            localField: "credential_id",
            foreignField: "_id",
          },
        },
        {
          $unwind: "$user_credentials",
        },
        {
          $lookup: {
            from: "user_acl",
            let: { acl: "$user_credentials.acl" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$acl"] } } },
              {
                $project: {
                  _partition: 0,
                  __v: 0,
                  active: 0,
                  user_id: 0,
                  outlet: 0,
                  license: 0,
                  createdAt: 0,
                  updatedAt: 0,
                  createdBy: 0,
                  updatedBy: 0,
                },
              },
            ],
            as: "user_acl",
          },
        },
        {
          $unwind: "$user_acl",
        },
        {
          $project: {
            user_acl: 1,
          },
        },
      ])
      .toArray();
  };

  // Helper function
  const formatReturn = (ACL, user_acl) => {
    return ACL.map((v) => ({ ...v, value: user_acl[v.id] ?? false }));
  };

  const FETCH_ACL = async () => {
    const acl = await dbGETFetchACL();
    return acl[0].user_acl;
  };

  return Object.freeze({ GET, FETCH_ACL });
};
