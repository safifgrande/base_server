exports = async (payload) => {
  try {
    const generalFunction = await confirmationEwallet(payload);

    const { method } = payload;

    if (generalFunction[method]) {
      return await generalFunction[method]();
    } else {
      return "method is not exists";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "adminEwallet"
    );
  }
};

const confirmationEwallet = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");
  const db = mongodb.db(context.values.get("DB_NAME"));
  const ENV = context.environment.tag;

  /*
    exports({
      method: "CONFIRMATION",
      data:{
        outlet_id: "6303262a1bfe08a3bdd6e6a0"
      }
    })
  */

  const CONFIRMATION = async () => {
    // validation
    await confirmationValidation();

    // // create or find subaccount in xendit_link_account
    const sub_account_id = await createOrFindAccount();

    // update data schema user field xendit_id dan payment_media by license
    if (sub_account_id) {
      await updateSomeSchema(sub_account_id);
    }

    return sub_account_id;
  };

  const deleteEmailOutlet = async () => {
    const { data } = payload;

    await db.collection(collectionNames.outlet).updateOne(
      {
        _id: BSON.ObjectId(data.outlet_id),
        license: data.outlet.license,
        // need license bisa mendapatkan license setelah query outlet
      },
      {
        $set: {
          outlet_email: "",
          email_verified: false,
        },
        $inc: { __v: 1 },
      }
    );

    throw new Error("Email sudah digunakan di akun lain");
  };

  const updateSomeSchema = async (xendit_id) => {
    const { data } = payload;

    await db.collection(collectionNames.xendit_link_account).updateOne(
      {
        email: data.outlet.outlet_email,
      },
      {
        $set: {
          _partition: data.outlet._id.toString(),
          outlet: data.outlet._id,
          owner_license: data.outlet.license,
        },
      }
    );

    await db.collection(collectionNames.outlet).updateOne(
      {
        _id: BSON.ObjectId(data.outlet_id),
        license: data.outlet.license,
      },
      {
        $set: {
          xendit_id,
          xendit_active: true,
        },
        $inc: { __v: 1 },
      }
    );
  };

  const confirmationValidation = async () => {
    const { data } = payload;

    valid.isObjValid(data, "outlet_id", "E20033BE", true);

    /*
      Get business by outlet and query to xendit_link_account to check link account

    */
    let business_by_outlet = await db
      .collection(collectionNames.outlet)
      .aggregate([
        {
          $match: {
            _id: BSON.ObjectId(data.outlet_id),
            // tidak query berdasarkan license karena method confirmation
            // di eksekusi oleh admin
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
                $project: { _id: 1, name: 1, license: 1 },
              },
            ],
            as: "user_business",
          },
        },
        {
          $lookup: {
            from: "xendit_link_account",
            localField: "outlet_email",
            foreignField: "email",
            as: "xendit_account",
          },
        },
        {
          $unwind: {
            path: "$user_business",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $unwind: {
            path: "$xendit_account",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            _id: 1,
            license: 1,
            name: 1,
            outlet_email: 1,
            email_verified: 1,
            user_business: {
              _id: 1,
              name: 1,
              license: 1,
            },
            xendit_account: {
              _id: 1,
              email: 1,
              xendit_sub_account_id: 1,
              owner_license: 1,
              outlet: 1,
            },
          },
        },
      ])
      .toArray();

    if (!business_by_outlet) throw new Error("E30102BE");

    // inject data outlet to payload.data.outlet
    data.outlet = business_by_outlet[0];

    // check email in outlet_email, check email verify from email, and xendit_link_account
    if (!business_by_outlet[0]?.outlet_email) throw new Error("E30109BE");
    if (!business_by_outlet[0]?.email_verified) throw new Error("E30110BE");
    if (business_by_outlet[0]?.xendit_account) {
      const { owner_license, xendit_sub_account_id } =
        business_by_outlet[0]?.xendit_account;

      if (
        !owner_license ||
        owner_license.toString() !== business_by_outlet[0].license.toString()
      ) {
        const user_license_found = await db
          .collection(collectionNames.user)
          .count({
            license: owner_license ?? "",
          });
        // jika license email masih exist maka email_outlet masih digunakan di outlet lain
        if (user_license_found) {
          data.license = owner_license;
          await deleteEmailOutlet();
        }

        data.license = business_by_outlet[0].license;
      }

      if (
        owner_license &&
        owner_license.toString() == business_by_outlet[0].license.toString() &&
        !xendit_sub_account_id
      ) {
        throw new Error(
          "Email sudah terdaftar di xendit_sub_account silahkan hubungi dev team"
        );
      }
    }
  };

  const createOrFindAccount = async () => {
    const { data } = payload;

    let data_return;
    if (!data.outlet.xendit_account) {
      const url = context.environment.values.XENDIT_API_URL_V2;
      const key = context.environment.values.XENDIT_PRIVATE_KEY;

      const body = JSON.stringify({
        id: new BSON.ObjectId(),
        created: new Date(),
        updated: new Date(),
        type: "OWNED",
        email: data.outlet.outlet_email,
        public_profile: {
          business_name: data.outlet.user_business.name,
        },
        status: "LIVE",
      });

      const createSubAccount = await context.http.post({
        url: url + "accounts",
        headers: {
          "Content-Type": ["application/json"],
          Accept: ["application/json"],
          Authorization: [`Basic ${BSON.Binary.fromText(key).toBase64()}`],
        },
        body,
      });

      if (createSubAccount.statusCode > 400) {
        if (createSubAccount.statusCode === 409) {
          await reStoreXenditLinkAccount();
          data_return = null;
        } else {
          throw new Error(
            "Create Sub-Account Failed : " + createSubAccount.status
          );
        }
      }

      if (createSubAccount.statusCode < 400) {
        // parse return create account
        const retCreateAccount = EJSON.parse(createSubAccount.body.text());

        // insert data from xendit_link_account
        const dataInsert = {
          __v: 0,
          _id: new BSON.ObjectId(),
          _partition: data.outlet_id,
          email: retCreateAccount.email,
          xendit_sub_account_id: retCreateAccount.id,
          outlet: BSON.ObjectId(data.outlet_id),
          owner_license: BSON.ObjectId(data.outlet.license.toString()),
        };

        await db
          .collection(collectionNames.xendit_link_account)
          .insertOne(dataInsert);

        await createXenditBridge(dataInsert);

        data_return = dataInsert.xendit_sub_account_id;
      }
    } else {
      data_return = data.outlet.xendit_account.xendit_sub_account_id;
    }

    return data_return;
  };

  const reStoreXenditLinkAccount = async () => {
    const { data } = payload;

    const dataInsert = {
      __v: 0,
      _id: new BSON.ObjectId(),
      _partition: data.outlet_id,
      email: data.outlet.outlet_email,
      xendit_sub_account_id: "",
      outlet: BSON.ObjectId(data.outlet_id),
      owner_license: BSON.ObjectId(data.outlet.license.toString()),
    };

    await db
      .collection(collectionNames.xendit_link_account)
      .insertOne(dataInsert);

    await createXenditBridge(dataInsert);

    throw new Error(
      "Email sudah terdaftar di xendit_sub_account silahkan hubungi dev team"
    );
  };

  const createXenditBridge = async (dataInsert) => {
    if (ENV !== "production") {
      await context.http.post({
        url: context.environment.values.XENDIT_BRIDGE,
        headers: {
          "Content-Type": ["application/json"],
          Accept: ["application/json"],
        },
        body: JSON.stringify(dataInsert),
      });
    }
  };

  return Object.freeze({ CONFIRMATION });
};
