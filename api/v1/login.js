module.exports = async (req, res) => {
  const body = req.body;
  if (body) {
    const valid = context.functions.execute("intValidation");

    const mongodb = context.services.get("test");
    const access = mongodb.db(context.values.get("DB_NAME"));
    const db = access.collection("user");

    const currentUser = await db
      .aggregate([
        {
          $match: {
            username: body.username.toLowerCase(),
            password: valid.hashPassword(body.password),
            active: true,
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
                  bo_report: 1,
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
            _id: 1,
            username: 1,
            license: 1,
            type: 1,
            fullname: 1,
            phone: 1,
            user_acl: 1,
          },
        },
      ])
      .toArray();

    res.status(200).json({
      message: "success",
      data: {
        realm_jwt: context.functions.execute("intGenerateCustomJwt", {
          userData: currentUser[0],
        }),
      },
    });
  } else {
    res.status(401).json({ message: "no credential" });
  }
};
