exports = async (payload) => {
  try {
    const eWalletObj = await eWalletFunction(payload);

    const { method } = payload;
    if (eWalletObj[method]) {
      return await eWalletObj[method]();
    } else {
      return "method is not exists";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientEwallet"
    );
  }
};

const eWalletFunction = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { license, _id: user_id } = context.functions.execute("intUserContext");
  const url = context.environment.values.XENDIT_API_URL;
  const url_v2 = context.environment.values.XENDIT_API_URL_V2;
  const key = context.environment.values.XENDIT_PRIVATE_KEY;
  const ENV = context.environment.tag;

  // Main method =============
  const ACTIVATION = async () => {
    /*
      exports(
        {
         method: 'ACTIVATION',
         data: {
          identity_url : "cascasca",
          selfie_image: "selfie_image_link",
          media_social_link: "media_social_link",
          bank_code: "BCA",
          nik: "3524143110950003",
          bank_account_number: "62710012319",
          bank_account_owner: "Safif Rafi Effendy",
          outlet_id: "62455629a414a2e32d723d43",
          email: "esafif637@gmail.com",
         },
         filter: {}
        }
      )
    */
    // validation request and data by database
    await activationValidation();

    // validation email from xendit link accounts
    await linkAccountValidation();

    // update data
    await updateActivation();

    // notif to admin di handle watch dari admin
    await sendEmailEwalletVerification();

    return true;
  };

  const GET_EWALLET_STATUS = async () => {
    /*
      exports(
      {
        method: 'GET_EWALLET_STATUS',
        data: {
          outlet_id: "621f21355922114973397330"
        },
        filter: {}
      }
    )
    */
    await valid.hasPermission(["bo_ewallet"]);

    let user_data = await getUserData();
    if (!user_data) throw new Error("E30101BE");
    user_data = user_data[0];

    const status_return = return_status(
      user_data.identity_url ? user_data.identity_url : "",
      user_data.outlet?.xendit_account?.email
        ? user_data.outlet.xendit_account.email
        : "",
      user_data.outlet?.outlet_email ? user_data.outlet.outlet_email : "",
      user_data.outlet?.email_verified ? user_data.outlet.email_verified : "",
      user_data.outlet?.xendit_active ? user_data.outlet.xendit_active : false
    );

    return {
      status: status_return,
      email: user_data.outlet?.outlet_email
        ? user_data.outlet.outlet_email
        : "",
    };
  };

  const GET_BANK = async () => {
    /*
      exports(
        {
          method: 'GET_BANK',
          data: {},
          filter: {}
        }
      )
    */
    await valid.hasPermission(["bo_ewallet"]);

    return context.values.get("CODE_BANKS");
  };

  const GET_EWALLET = async () => {
    /*
      exports(
        {
          method: 'GET_EWALLET',
          data: {},
          filter: {}
        }
      )
    */
    await valid.hasPermission(["bo_ewallet"]);

    return context.values.get("EWALLET_TYPES");
  };

  const GET_BALANCE = async () => {
    /* 
      {
        method: 'GET_BALANCE',
        data: {
          outlet_id: "621f21355922114973397330"
        },
        filter: {}
      } 
    */
    await valid.hasPermission(["bo_ewallet"]);

    const outlet = await _dbGetXenditID(payload.data.outlet_id);

    const req_balance = await context.http.get({
      url: url + "balance?account_type=CASH",
      headers: {
        "Content-Type": ["application/json"],
        Accept: ["application/json"],
        Authorization: [`Basic ${BSON.Binary.fromText(key).toBase64()}`],
        "for-user-id": [outlet.xendit_id],
      },
    });

    if (req_balance.statusCode > 400) throw new Error("Data not found");

    return {
      email: outlet.outlet_email,
      ...EJSON.parse(req_balance.body.text()),
    };
  };

  const RESEND_EMAIL = async () => {
    /*
      {
       method: 'RESEND_EMAIL',
        data: {
          outlet_id: "621f21355922114973397330",
          email: "esafif637@gmail.com"
        },
        filter: {}
      }
    */
    const { data } = payload;

    await valid.hasPermission(["bo_ewallet"]);

    await validationResend();

    //if data outlet different update outlet document
    if (data.outlet?.outlet_email !== data.email) {
      await db.collection(collectionNames.outlet).updateOne(
        {
          _id: BSON.ObjectId(data.outlet_id),
          license,
        },
        {
          $set: {
            outlet_email: data.email,
          },
        }
      );
    }

    // send email
    await sendEmailEwalletVerification();

    return true;
  };

  const GET_EWALLET_HISTORY = async () => {
    /*
      exports({
        method: 'GET_EWALLET_HISTORY',
        data: {},
        filter: {
          outlet_id: "6266142ab2036fe3df2900dc",
          type: "debit"
          // next page => after_id di isi
          // prev page => before_id di isi
          after_id: [string | xendit_id],
          before_id: [string | xendit_id],
          limit: 10, // default 25 
        }
      })
    */
    await valid.hasPermission(["bo_ewallet"]);

    const { xendit_id } = await _dbGetXenditID(payload.filter.outlet_id);
    // 1. validation
    ewalletHistoryValidation();
    // 2. fetch from xendit transaction
    const xenditTransactons = await _fetchXenditTransaction();
    // 3. query xendit transactions to mongodb
    const POSTransactions = await _dbGetTransactionData();
    // 4. build response
    return _formatingResponse();

    async function _fetchXenditTransaction() {
      let queryString = `transactions?limit=${payload.filter?.limit || 25}`;
      if (payload.filter?.after_id) {
        queryString += `&after_id=${payload.filter.after_id}`;
      }
      if (payload.filter?.before_id) {
        queryString += `&before_id=${payload.filter.before_id}`;
      }

      if (!payload.filter.type) {
        queryString += `&types=DISBURSEMENT&types=PAYMENT`;
      }

      switch (payload.filter.type) {
        case "credit":
          queryString += `&types=DISBURSEMENT`;
          break;
        case "debit":
          queryString += `&types=PAYMENT`;
          break;
      }

      const respTransList = await context.http.get({
        url: url + queryString,
        headers: {
          "Content-Type": ["application/json"],
          Accept: ["application/json"],
          Authorization: [`Basic ${BSON.Binary.fromText(key).toBase64()}`],
          "for-user-id": [xendit_id],
        },
      });
      const xeditTransactions = EJSON.parse(respTransList.body.text());
      if (respTransList.statusCode != 200) {
        throw new Error(xeditTransactions.message);
      }

      return xeditTransactions;
    }

    function ewalletHistoryValidation() {
      const { filter } = payload;

      const xenditIdpattern =
        /^txn_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

      if (filter?.after_id && !xenditIdpattern.test(filter.after_id)) {
        throw new Error("E20023BE");
      }

      if (filter?.before_id && !xenditIdpattern.test(filter.before_id)) {
        throw new Error("E20023BE");
      }
    }

    async function _dbGetTransactionData() {
      const { filter } = payload;
      const data = xenditTransactons.data;

      const matchAggregate = {
        license,
        _id: {
          $in: data.reduce((prev, curr) => {
            const objectIdCheck = /^[0-9a-fA-F]{24}$/;
            if (!objectIdCheck.test(curr.reference_id)) return prev;
            return [...prev, BSON.ObjectId(curr.reference_id)];
          }, []),
        },
      };

      if (filter.outlet_id) {
        matchAggregate.outlet = BSON.ObjectId(filter.outlet_id);
      }

      return db
        .collection(collectionNames.ewallet_gateway)
        .aggregate([
          {
            $match: matchAggregate,
          },
          {
            $lookup: {
              from: "transaction",
              let: { id: "$transaction_id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$_id", "$$id"] } } },
                {
                  $project: {
                    _id: 0,
                    bill_number: 1,
                    status: 1,
                  },
                },
              ],
              as: "transaction",
            },
          },
          {
            $unwind: {
              path: "$transaction",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 1,
              amount: "$xendit_amount",
              ewallet_type: 1,
              createdAt: 1,
              updatedAt: 1,
              action_type: 1,
              status: "$transaction.status",
              bill_number: "$transaction.bill_number",
              xendit_trans_id: 1,
            },
          },
          {
            $sort: {
              updatedAt: -1,
            },
          },
        ])
        .toArray();
    }

    function _formatingResponse() {
      const data = xenditTransactons.data;

      if (data.length == 0) {
        return {
          data: [],
          has_more: false,
        };
      }

      const data_list = data.map((trans) => {
        const data = {
          xendit_status: ["SUCCESS", "PENDING"].includes(trans.status)
            ? trans.status.toLowerCase()
            : "failed",
          id: trans.reference_id,
          xendit_id: trans.id,
          xendit_fee: trans.fee.xendit_fee,
          value_added_tax: trans.fee.value_added_tax,
          settled: trans.settlement_status == "SETTLED" ? true : false,
          settlement_date: trans.estimated_settlement_time || null,
        };
        switch (trans.type) {
          case "PAYMENT":
            const POSTransData = POSTransactions.find(
              (v) => v._id.toString() === trans.reference_id
            );
            const errorMessages = context.values.get("ERROR_MESSAGES");
            const issue = errorMessages["E60001BE"]
              ? errorMessages["E60001BE"][payload?.headers?.Lang || "en"]
              : "";

            if (!POSTransData?.xendit_trans_id) {
              data.issue_info = issue;
              data.issue_solution = "";
            }

            return {
              ...data,
              amount: trans.amount,
              net_amount: trans.net_amount,
              bill_number: POSTransData?.bill_number || "-",
              createdAt: POSTransData?.createdAt || "-",
              trans_status: POSTransData?.status || "-",
              ewallet_type: POSTransData?.ewallet_type || "-",
            };
          // ada type selain dishbursment(transfer),
          default:
            return {
              ...data,
              amount: -trans.amount,
              net_amount: -trans.net_amount,
              bill_number: "-",
              createdAt: POSTransData?.createdAt,
              trans_status: "success",
              ewallet_type: "-",
            };
        }
      });

      return {
        data: data_list,
        has_more: xenditTransactons.has_more,
      };
    }
  };

  const GET_EWALLET_FEE = async () => {
    /* {
       method: 'GET_EWALLET_FEE',
      data: {
        outlet_id: "621f21355922114973397330"
      },
      filter: {}
    } */
    await valid.hasPermission(["bo_ewallet"]);

    return getEwalletFee();
  };

  // Database ===========
  const _dbGetXenditID = (outlet_id) => {
    return db.collection(collectionNames.outlet).findOne(
      {
        _id: BSON.ObjectId(outlet_id),
        license,
      },
      {
        _id: 1,
        outlet_email: 1,
        xendit_id: 1,
      }
    );
  };

  // Helper =============
  const sendEmailEwalletVerification = async () => {
    const { data } = payload;

    const base_url = context.environment.values.SETUP_EMAIL_SERVER;
    const urlGetToken = base_url + "/api/auth/generateToken";
    const url_send_email = base_url + "/api/users/sendverification";
    const email_template = context.values.get("EMAIL_TEMPLATE");
    const token = Buffer.from(data.email, "utf8").toString("base64");
    const fullVerifyURL = `${context.environment.values.EWALLET_EMAIL_VERIFIER}?data=${token}`;

    const getToken = await context.http.post({
      url: urlGetToken,
      headers: {
        "Content-Type": ["application/json"],
        Accept: ["application/json"],
      },
      body: {
        email: data.email,
      },
      encodeBodyAsJSON: true,
    });

    const tokenJwt = EJSON.parse(getToken.body.text()).token;

    const user = await db.collection(collectionNames.user).findOne(
      {
        _id: BSON.ObjectId(user_id.toString()),
        license,
      },
      {
        _id: 1,
        fullname: 1,
      }
    );

    // // FIXME: Body untuk fromName dan fromAddress perlu di ganti jika di production
    const sendEmailResult = await context.http.post({
      url: url_send_email,
      headers: {
        "Content-Type": ["application/json"],
        Authorization: [`Bearer ${tokenJwt}`],
        Accept: ["application/json"],
      },
      body: {
        to: data.email,
        toName: user.fullname,
        fromName: "Grande POS <cs@grandepos.io>",
        fromAddress: "cs@grandepos.io",
        subject: "Verifikasi Ewallet Email",
        link: fullVerifyURL,
        template: email_template.verifyEwallet,
      },
      encodeBodyAsJSON: true,
    });

    const sendEmailResultData = EJSON.parse(sendEmailResult.body.text());

    if (!sendEmailResultData.status) {
      throw new Error("Cannot send email verification to : " + email);
    }

    return sendEmailResultData.status;
  };

  const linkAccountValidation = async () => {
    const { data } = payload;

    /*
      tidak di query menggunakan license ,
      bisa jadi email di pakek di license yg berbeda ,
      sehingga jika ada case seperti itu di kelurakan error
    */
    let account = await context.functions.execute(
      "intSystemQuery",
      collectionNames.xendit_link_account,
      [
        {
          $project: {
            email: { $toLower: "$email" },
          },
        },
        {
          $match: {
            email: data.email.toLowerCase(),
          },
        },
        {
          $lookup: {
            from: "outlet",
            localField: "email",
            foreignField: "outlet_email",
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
            _id: 1,
            owner_license: 1,
            email: 1,
            outlet: {
              _id: 1,
              outlet_email: 1,
              license: 1, // license bisa di dapatkan dari sini
            },
          },
        },
      ]
    );

    account = account[0];

    // license type object cannot be compare thats why using toString()
    // xendit_link_account tidak di kasih rules karena email mungkin sudah di pakai di license lain
    if (
      account &&
      account.outlet &&
      account.owner_license.toString() === account.outlet.license.toString()
    ) {
      throw new Error("E30103BE");
    }
  };

  const updateActivation = async () => {
    const { data } = payload;

    // update collection user
    if (data.identity_url) {
      await db.collection(collectionNames.user).updateOne(
        {
          license,
          type: "owner",
        },
        {
          $set: {
            nik: data.nik,
            identity_url: data.identity_url,
            selfie_image: data.selfie_image ? data.selfie_image : "",
            media_social_link: data.media_social_link
              ? data.media_social_link
              : "",
          },
        }
      );
    }

    // update collection outlet
    if (data.email) {
      await db.collection(collectionNames.outlet).updateOne(
        {
          _id: BSON.ObjectId(data.outlet_id),
          license,
        },
        {
          $set: {
            outlet_email: data.email.toLowerCase(),
            email_verified: false,
            xendit_active: false,
          },
        }
      );
    }

    // data.bank_account di validasi di activation validation
    if (!data.bank_account) {
      await db.collection(collectionNames.user_bank_account).insertOne({
        _id: new BSON.ObjectId(),
        __v: 0,
        bank_code: data.bank_code,
        bank_name: data.bank_code,
        active: true,
        account_number: data.bank_account_number.toString(),
        account_owner: data.bank_account_owner,
        license: license,
        user_id: new BSON.ObjectId(user_id),
        createdAt: new Date(),
        createdBy: BSON.ObjectId(user_id),
        updatedAt: new Date(),
        updatedBy: new BSON.ObjectId(user_id),
      });
    }
  };

  const bankAccountValidation = async () => {
    const { data } = payload;
    const bank_account = await db
      .collection(collectionNames.user_bank_account)
      .count({
        license,
      });

    if (!bank_account) {
      valid.isObjValid(data, "bank_account_number", "E20208BE", true);
      valid.isObjValid(data, "bank_account_owner", "E20209BE", true);
      valid.isObjValid(data, "bank_code", "E20207BE", true);

      // bank_account_number hanya boleh di isi angka
      if (!/^[0-9]+$/.test(data.bank_account_number)) {
        throw new Error("E20024BE");
      }

      data.bank_account = false; // untuk check perlu buat new account atau tidak
    } else {
      data.bank_account = true; // untuk check perlu buat new account atau tidak
    }
  };

  const activationValidation = async () => {
    const { data } = payload;

    await valid.hasPermission(["bo_ewallet"]);

    valid.isObjValid(data, "outlet_id", "E20033BE", true);

    await bankAccountValidation();

    const checkIdentityUrl = (await checkIdentity())[0];
    console.log("checkIdentityUrl", JSON.stringify(checkIdentityUrl));
    // tidak jadi 2 validasi
    // ketika identity dari db sudah di set maka tidak wajib untuk cek dari payload
    if (!checkIdentityUrl.identity_url) {
      valid.isObjValid(data, "identity_url", "E20206BE", true);
    }

    if (!checkIdentityUrl.nik) {
      valid.isObjValid(data, "nik", "E20217BE", true);
    }
    if (!checkIdentityUrl.outlet.outlet_email) {
      valid.isObjValid(data, "email", "E20001BE", true);
    }

    // check number accounts already exists
    const accounts = checkIdentityUrl?.user_bank_account
      ? checkIdentityUrl.user_bank_account
      : [];

    const accountExists = accounts.find(
      (v) =>
        v.account_number === data.bank_account_number &&
        v.license.toString() === license.toString()
    );
    if (accountExists) throw new Error("E30100BE");

    // find if nik found in another license
    if (data.nik) {
      let user_nik = await checkNIK();

      if (
        user_nik?.nik === data.nik &&
        user_nik?.license.toString() !== license.toString()
      )
        throw new Error("E30107BE");
    }

    await validationEmailInOutlet();

    if (ENV !== "production") {
      let account = await context.functions.execute(
        "intSystemQuery",
        collectionNames.xendit_link_account,
        [
          {
            $match: {
              email: data.email,
            },
          },
          {
            $project: {
              _id: 1,
              email: 1,
            },
          },
        ]
      );

      if (account.length === 0) {
        await validationAndStoreXenditData(checkIdentityUrl);
      }
    }
  };

  const checkNIK = async () => {
    const { data } = payload;

    return context.functions.execute("intSystemQuery", collectionNames.user, [
      {
        $match: {
          nik: data.nik,
        },
      },
      {
        $project: {
          _id: 1,
          nik: 1,
          license: 1,
        },
      },
    ])[0];
  };

  const checkIdentity = async () => {
    const { data } = payload;

    return await db
      .collection(collectionNames.user)
      .aggregate([
        {
          $match: {
            license,
            type: "owner",
          },
        },
        {
          $lookup: {
            from: "outlet",
            let: { outlet_id: [BSON.ObjectId(data.outlet_id)] },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", "$$outlet_id"] },
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
                  path: "$xendit_account",
                  preserveNullAndEmptyArrays: true,
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
          $lookup: {
            from: "user_bank_account",
            let: { outlet_id: [BSON.ObjectId(data.outlet_id)] },
            pipeline: [
              { $match: { $expr: { $in: ["$outlet", "$$outlet_id"] } } },
            ],
            as: "user_bank_account",
          },
        },
        {
          $project: {
            _id: 1,
            type: 1,
            identity_url: 1,
            nik: 1,
            outlet: {
              _id: 1,
              outlet_email: 1,
              xendit_account: 1,
            },
            user_bank_account: {
              _id: 1,
              bank_code: 1,
              account_number: 1,
              license: 1,
            },
          },
        },
      ])
      .toArray();
  };

  const validationEmailInOutlet = async () => {
    const { data } = payload;
    const emailIsAlready = await context.functions.execute(
      "intSystemQuery",
      "outlet",
      [
        {
          $match: {
            outlet_email: { $regex: data.email, $options: "i" },
          },
        },
        {
          $project: {
            _id: 1,
          },
        },
      ]
    );

    if (emailIsAlready.length > 0) throw new Error("E30037BE");
  };

  const validationAndStoreXenditData = async (checkIdentityUrl) => {
    const { data } = payload;

    const getXenditAccount = await context.http.get({
      url: url_v2 + `accounts/?email=${data.email}`,
      headers: {
        "Content-Type": ["application/json"],
        Accept: ["application/json"],
        Authorization: [`Basic ${BSON.Binary.fromText(key).toBase64()}`],
      },
    });

    const get_body = EJSON.parse(getXenditAccount.body.text());

    if (!checkIdentityUrl.outlet.xendit_account && get_body?.data?.length > 0) {
      await db.collection(collectionNames.xendit_link_account).insertOne({
        __v: 0,
        _partition: null,
        outlet: null,
        owner_license: null,
        email: get_body.data[0].email,
        xendit_sub_account_id: get_body.data[0].id,
      });
    }
  };

  const return_status = (
    identity_url,
    user_email_xendit,
    outlet_email,
    email_verified,
    xendit_active
  ) => {
    let status;

    if (
      identity_url &&
      user_email_xendit &&
      outlet_email &&
      email_verified &&
      xendit_active
    )
      status = "active";
    if (
      identity_url &&
      !user_email_xendit &&
      outlet_email &&
      email_verified &&
      !xendit_active
    )
      status = "pending";
    if (
      identity_url &&
      user_email_xendit &&
      outlet_email &&
      email_verified &&
      !xendit_active
    )
      status = "pending";

    if (
      identity_url &&
      (!user_email_xendit || user_email_xendit) &&
      outlet_email &&
      !email_verified
    )
      status = "unverified";
    if (identity_url && !user_email_xendit && !outlet_email)
      status = "new_without_identity";
    if (!identity_url && !user_email_xendit && !outlet_email)
      status = "new_with_identity";

    return status;
  };

  const getUserData = async () => {
    const { data } = payload;

    return await db
      .collection(collectionNames.user)
      .aggregate([
        {
          $match: {
            type: "owner",
            license,
          },
        },
        {
          $lookup: {
            from: "outlet",
            let: { license: "$license" },
            pipeline: [
              {
                $match: {
                  _id: BSON.ObjectId(data.outlet_id),
                  license: license,
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
                  path: "$xendit_account",
                  preserveNullAndEmptyArrays: true,
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
            _id: 1,
            email: 1,
            identity_url: 1,
            nik: 1,
            outlet: {
              _id: 1,
              name: 1,
              email_verified: 1,
              xendit_active: 1,
              outlet_email: 1,
              xendit_account: {
                _id: 1,
                email: 1,
              },
            },
          },
        },
      ])
      .toArray();
  };

  const validationResend = async () => {
    const { data } = payload;

    valid.isObjValid(data, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "email", "E20001BE", true);

    let user_data = await getUserData();

    const { identity_url, nik, outlet } = user_data[0];

    if (!identity_url && !nik && !outlet?.outlet_email) {
      throw new Error("E30116BE");
    }

    await linkAccountValidation();
  };

  const getEwalletFee = async () => {
    const { data } = payload;

    const [country] = await db
      .collection(collectionNames.outlet)
      .aggregate([
        {
          $match: {
            _id: BSON.ObjectId(data.outlet_id),
          },
        },
        { $project: { country: 1, xendit_id: 1 } },
        {
          $lookup: {
            from: collectionNames.master_reg_country,
            let: { country: "$country" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$country"] } } },
              {
                $project: {
                  _id: 0,
                  generalConfig: { $ifNull: ["$generalConfig", []] },
                },
              },
            ],
            as: "country",
          },
        },
        { $unwind: "$country" },
        { $project: { country: 1, xendit_id: 1 } },
      ])
      .toArray();

    if (!country) throw new Error("E30032BE");

    const generalConfig = country.country.generalConfig.filter(
      (e) => e.key === "ewalletFee" || e.key === "ewalletVat"
    );

    return generalConfig;
  };

  return Object.freeze({
    ACTIVATION,
    GET_BANK,
    GET_EWALLET,
    GET_EWALLET_STATUS,
    GET_BALANCE,
    RESEND_EMAIL,
    GET_EWALLET_HISTORY,
    GET_EWALLET_FEE,
  });
};
