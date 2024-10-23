module.exports = async (payload) => {
  try {
    const masterRequest = await masterFunction(payload);
    if (masterRequest[payload.method]) {
      return await masterRequest[payload.method]();
    }
    throw new Error("Method not found in request");
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientUser"
    );
  }
};

const masterFunction = async (payload) => {
  const valid = context.functions.execute("intValidation");

  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  const crypto = require("crypto");

  // ================ MAIN method start ========================
  /*
    exports({
      method: 'GET',
      filter: {},
      data:{}
    })

    // 1. validate ACL
    2. get detail user from db
    3. get bank account for owner type user
    4. return user format
  */
  const GET = async () => {
    // 1. validate ACL
    // 20220831: remove validasi ini karena user tidak bisa lihat profile
    // if (
    //   !(await valid.hasPermission(["bo_staff", "bo_staff"], false))
    // ) {
    //   return [];
    // }

    // 2. get detail user from db
    const userdetail = await dbGETUserDetail();

    // 3. get bank account for owner type user
    await getBank(userdetail[0]);

    // 4. return user format
    return getReturnFormat(userdetail);
  };

  /*
    exports({
      "method":"LIST",
      "data":null,
      "filter":{
        "business_id": "6156606885345c6e13961071",
        "outlet_id":""
      }
    })
  */
  const LIST = async () => {
    // 1. validate ACL
    if (!(await valid.hasPermission(["bo_staff"], false))) {
      return [];
    }

    // 2. validate & build filter
    await validationAndFilter();

    // 3. get user from db
    const userstaff = await dbListUser();

    // 4. return userstaff
    return listReturnFormat(userstaff);
  };

  /*
    exports({
      method: 'GET_DETAIL',
      filter: {
        id: '613b179bff82f4c5e7d9297c'
      },
      data:{}
    })

    1. validate acl
    2. validate and build filter
    3. get detail user from db
    4. return detail format
  */
  const GET_DETAIL = async () => {
    // 1. validate acl
    if (!(await valid.hasPermission(["bo_staff"], false))) {
      return [];
    }
    // 2. validate and build filter
    GET_DETAILValidation();

    // 3. get detail user from db
    const userdetail = await dbGET_DETAILUserWithACL();

    // 4. return detail format
    return getDetailFormaReturn(userdetail);
  };

  /*
    exports({
      method: 'POST',
      filter: {},
      data:{
        id:'', // di isi ketika kondisi update
        outlet_id:'outlet_id',
        fullname:'fullname',
        phone:'',
        username: '',
        password: '',
        pin:'',
        active: true,
        image_url: '',
        auth_bo: boolean,
        auth_pos: boolean,
        acl:{...list of acl},
        msr_token:''
      }
    })

    1. POST validation
    2. handle save user
  */
  const POST = async () => {
    // 1. POST validation
    await POSTValidation();

    // 2. handle save user
    if (!payload.data.id) {
      return createUser();
    } else {
      const existingUser = await dbPOSTGetExistingUser();

      // validasi name setelah get existing data user
      await updateValidationFullname(existingUser);

      POST_ValidateWithExistingUser(existingUser);

      return updateUser(existingUser);
    }
  };

  /*
    exports({
      method: 'UPDATE_PASSWORD',
      data: {
        user_id: [string | required],
        password: [string | required]
      }
    })

    1. validate payload
    2. update user
  */
  const UPDATE_PASSWORD = async () => {
    // 1. validate payload
    UPDATE_PASSWORD_validation();

    // 2. update user
    await UPDATE_PASSWORD_updateUser();

    return {
      status: true,
      message: "success",
      data: null,
      error: "",
    };
  };

  /*
    exports({
      method: 'ACTIVE',
      data: {
        active: false
      },
      filter: {
        id: '611e15a754b237abe9585c5d',
        outlet_id: '611e1583f7bf5674c1785822'
      }
    })
  */
  const ACTIVE = async () => {
    // 1. validate & build filter
    await activeValidation();

    // 2. active/deactive user
    const foundStaff = await updateActiveUser();

    // 3. check user is exist
    if (!foundStaff) {
      throw new Error("E20019BE");
    }

    // 4. active/deactive user_credentials
    const user_cred = await updateActiveUserCredential(foundStaff);

    // 5. check credential is exist
    if (!user_cred) {
      throw new Error("E30010BE");
    }

    return payload.filter._id.toString();
  };

  /*
    exports({
      method: 'UPDATE_PIN',
      data: {
        old_pin: string,
        new_pin: string
      },
      filter: {
        id: '611e15a754b237abe9585c5d'
      }
    })
  */
  const UPDATE_PIN = async () => {
    // 1. validation
    await UPDATE_PINValidation();

    // 2. update pin
    await dbUPDATE_PINSaveNewPIN();

    return payload.filter._id.toString();
  };

  /*
    exports({
      method: 'UPDATE_MSR',
      data: {
        msr_token: "ini token",
      },
      filter: {
        id: '611e15a754b237abe9585c5d'
      }
    })
  */
  const UPDATE_MSR = async () => {
    await validateUpdateMsr();

    await updateMsr();

    return payload.filter.id;
  };
  // ================ MAIN method end   ========================

  const getBank = async (userdetail) => {
    const { list_outlet_id } = userdetail;

    if (userdetail.type !== "owner" || list_outlet_id.length === 0) {
      return [];
    }

    const queryBank = await db
      .collection(collectionNames.user_bank_account)
      .find(
        {
          license: user.license,
        },
        {
          bank_code: 1,
          bank_name: 1,
          account_number: 1,
          account_owner: 1,
          owner: 1,
        }
      )
      .toArray();

    userdetail.bank_account = queryBank ? queryBank[0] : {};
  };

  const getReturnFormat = async (userReturn) => {
    // masih perlu di fix ada beberapa response yang tidak di gunakan
    if (userReturn[0].type == "owner") {
      userReturn[0].outlet = "all";
    }

    if (userReturn[0].type === "staff") {
      userReturn[0].outlet = userReturn[0].list_outlet_id[0].outlet.name;
    }

    userReturn[0].id = userReturn[0]._id.toString();

    delete userReturn[0]._id;

    const checkXenditActive =
      userReturn[0].list_outlet_id[0].outlet.xendit_active;

    if (userReturn[0]?.bank_account) {
      userReturn[0].bank_account.id = userReturn[0].bank_account._id.toString();
      delete userReturn[0]?.bank_account._id;
    }

    if (!checkXenditActive || checkXenditActive?.xendit_active === false) {
      delete userReturn[0]?.identity_url;
      delete userReturn[0]?.media_social_link;
      delete userReturn[0]?.nik;
      delete userReturn[0]?.bank_account;
    }

    // yg bisa lihat user identity hanya owner
    if (userReturn[0].type !== "owner") {
      delete userReturn[0]?.identity_url;
      delete userReturn[0]?.media_social_link;
      delete userReturn[0]?.nik;
    }

    return userReturn[0];
  };

  const validationAndFilter = async () => {
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

  const dbListUser = () => {
    const { filter } = payload;

    return db
      .collection(collectionNames.user_credentials)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: "outlet",
            localField: "outlet",
            foreignField: "_id",
            as: "outlet",
          },
        },
        {
          $unwind: "$outlet",
        },
        {
          $lookup: {
            from: "user",
            localField: "_id",
            foreignField: "credential_id",
            as: "user_detail",
          },
        },
        {
          $match: {
            "user_detail.type": { $ne: "owner" },
          },
        },
        {
          $project: {
            fullname: 1,
            active: 1,
            pin: 1,
            outlet: { _id: 1, name: 1 },
            user_detail: { _id: 1, username: 1, password: 1 },
            lowerName: { $toLower: "$fullname" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();
  };

  const listReturnFormat = (users) => {
    return users.map((v) => {
      const {
        fullname,
        active,
        pin,
        outlet,
        user_detail: [{ _id: user_id, username: username, password: password }],
      } = v;

      let otorisasi = [];

      if (username && password) {
        otorisasi.push("BO");
      }

      if (pin) {
        otorisasi.push("POS");
      }

      return {
        id: user_id.toString(), // mengambil id user bukan mengambil id user_credentilas saat di return
        fullname,
        active,
        otorisasi: otorisasi.join(),
        outlet_id: outlet._id.toString(),
        outlet_name: outlet.name,
      };
    });
  };

  const getDetailFormaReturn = (userDetail) => {
    const {
      _id,
      fullname,
      username,
      phone,
      active,
      type,
      image_url,
      user_credential: {
        outlet: { _id: outlet_id, name: outlet_name },
        acl,
        pin, // tidak boleh di response ke client
        msr_token, // tidak boleh di response ke client
      },
    } = userDetail[0];
    return {
      id: _id.toString(),
      fullname,
      username,
      phone,
      active,
      outlet_id: outlet_id.toString(),
      outlet_name,
      type,
      image_url,
      auth_bo: !!username,
      auth_pos: pin || msr_token ? true : false,
      msr_exist: msr_token ? true : false,
      acl,
    };
  };

  const preparedPostdata = () => {
    const by = {
      __v: 0,
      license: BSON.ObjectId(user.license.toString()),
      active: payload.data.active,
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user._id.toString()),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id.toString()),
    };

    const data_user = {
      user_id: BSON.ObjectId(user._id.toString()),
      username: payload.data.username,
      fullname: payload.data.fullname,
      image_url: payload.data?.image_url || "",
      phone: payload.data.phone,
    };

    let post_msr = {};
    if (payload.data.msr_token) {
      post_msr.msr_token = payload.data.msr_token;
    }

    return {
      user_id: payload.data.id
        ? BSON.ObjectId(payload.data.id.toString())
        : new BSON.ObjectId(),
      user_acl_id: new BSON.ObjectId(),
      credential_id: new BSON.ObjectId(),
      outlet: BSON.ObjectId(payload.data.outlet_id.toString()),
      by,
      data_user,
      post_msr,
    };
  };

  const createUser = async () => {
    const prepared_data = preparedPostdata();

    await dbPOSTCreateUser(prepared_data);
    await dbPOSTCreateUserACL(prepared_data);
    await dbPOSTCreateUserCredential(prepared_data);

    return prepared_data.user_id.toString();
  };

  const updateUser = async (existingUser) => {
    const prepared_data = preparedPostdata();

    await dbPOSTUpdateUser(prepared_data);
    await dbPOSTUpdateUserACL(existingUser, prepared_data.outlet);
    await dbPOSTUpdateUserCredential(prepared_data, existingUser);

    return prepared_data.user_id.toString();
  };

  const activeValidation = async () => {
    await valid.hasPermission(["bo_staff"]);
    if (!payload.filter) throw new Error("E20037BE");
    if (!payload.filter.outlet_id) throw new Error("E20033BE");
    if (!payload.filter.id) throw new Error("E20056BE");

    payload.filter.license = BSON.ObjectId(user.license.toString());

    // payload filter
    payload.filter.outlet = BSON.ObjectId(payload.filter.outlet_id.toString());
    payload.filter._id = BSON.ObjectId(payload.filter.id.toString());
    delete payload.filter.id;
    delete payload.filter.outlet_id;
  };

  const updateActiveUser = () => {
    const { filter, data } = payload;
    return db.collection(collectionNames.user).findOneAndUpdate(
      {
        license: filter.license,
        _id: filter._id,
      },
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id.toString()),
          active: data.active,
        },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1, credential_id: 1 },
      }
    );
  };

  const updateActiveUserCredential = (foundStaff) => {
    const { filter } = payload;

    filter._id = BSON.ObjectId(foundStaff.credential_id.toString());

    return db.collection(collectionNames.user_credentials).findOneAndUpdate(
      {
        ...filter,
      },
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id.toString()),
          active: payload.data.active,
        },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1 },
      }
    );
  };

  // ----------- Helper start -------------
  const UPDATE_PASSWORD_validation = () => {
    valid.isObjValid(context.user.data, "acl", "E10001BE", true);
    valid.isObjValid(payload, "data", "E20038BE", true);
    valid.isObjValid(payload.data, "user_id", "E20035BE", true);
    valid.isObjValid(payload.data, "password", "E20010BE", true);
    valid.isPassword(payload.data.password);
  };

  const updateValidationFullname = async (existingUser) => {
    // name validation
    const { data } = payload;

    const nameDataValidation = {
      fullname: data.fullname,
      outlet_id: data.outlet_id,
      id: existingUser.credential._id,
    };

    await valid.isUnique(
      nameDataValidation,
      collectionNames.user_credentials,
      "fullname",
      "E30128BE"
    );
  };

  const POST_ValidateWithExistingUser = (existingUser) => {
    if (
      !existingUser.credential.username &&
      payload.data.username &&
      !payload.data.password
    ) {
      throw new Error("E20010BE");
    } else if (existingUser.credential.username && !payload.data.auth_bo) {
      payload.data.username = "~~~delete~~~";
    }

    if (existingUser.credential.pin && !payload.data.auth_pos) {
      payload.data.pin = "~~~delete~~~";
    }
  };

  const GET_DETAILValidation = () => {
    let { filter } = payload;

    if (!filter.id) throw new Error("E20106BE");

    if (filter.id) {
      filter._id = BSON.ObjectId(filter.id.toString());
    }
    filter.license = user.license;

    delete filter.id;
  };

  const UPDATE_PINValidation = async () => {
    valid.isObjValid(payload, "data", "E20038BE", true);
    valid.isObjValid(payload.filter, "id", "E20035BE", true);
    valid.isObjValid(payload.data, "new_pin", "E20030BE", true);
    valid.isPIN(payload.data.new_pin);

    // aku prepare untuk keperluan tidak perlu old pin saat update pin owner
    // valid.isObjValid(payload.data, "old_pin", "E20030BE", true);
    // valid.isPIN(payload.data.old_pin);

    payload.filter._id = BSON.ObjectId(payload.filter.id);
    delete payload.filter.id;

    // check if PIN is used by another user
    if (await dbUPDATE_PINGetDuplicate()) {
      throw new Error("E30113BE");
    }
  };

  const POSTValidationACL = () => {
    const ACLList = context.functions.execute("intTranslatingAcl");

    const ACLDataKeys = Object.keys(payload.data.acl);

    // error sengaja dibuat text, karena ada kesalahan code client
    if (ACLDataKeys.length !== ACLList.length)
      throw new Error("ACL list salah");

    const ACLNotExits = ACLList.reduce((prev, acl) => {
      if (ACLDataKeys.indexOf(acl) === -1) {
        return [...prev, acl];
      } else {
        if (typeof payload.data.acl[acl] !== "boolean") {
          return [...prev, acl];
        }
        return [...prev];
      }
    }, []);

    if (ACLNotExits > 0) {
      // error sengaja dibuat text, karena ada kesalahan code client
      throw new Error(
        `ACL = ${JSON.stringify(ACLNotExits)} tidak ada di dalam request !`
      );
    }
  };

  const POSTValidateDuplicateUsernameOrPIN = async () => {
    const findUsers = await dbPOSTFindDuplicateUsername();

    if (findUsers.length > 0) {
      const isPhoneExists = findUsers.some(
        (v) => v.phone === payload.data.phone
      );
      if (isPhoneExists) {
        throw new Error("E30036BE");
      }
      throw new Error("E30028BE");
    }

    const findUserHasPin = await dbPOSTFindDuplicatePIN();
    if (findUserHasPin.length > 0) {
      throw new Error("E30028BE");
    }
  };

  const POSTValidationFullname = async () => {
    if (payload.data.id) {
      return;
    }

    await valid.isUnique(
      payload.data,
      collectionNames.user_credentials,
      "fullname",
      "E30128BE"
    );
  };

  const POSTValidateDuplicateMsrNumber = async () => {
    const findUsers = await dbPOSTFindDuplicateMsrNumber();
    if (findUsers.length > 0) {
      throw new Error("E30120BE");
    }
  };

  const POSTValidation = async () => {
    // validate ACL
    await valid.hasPermission(["bo_staff"]);

    // check payload
    valid.isObjValid(payload.data, "auth_bo", "E20218BE", true);
    valid.isObjValid(payload.data, "auth_pos", "E20219BE", true);
    valid.isObjValid(payload.data, "fullname", "E20005BE", true);
    valid.isObjValid(payload.data, "phone", "E20008BE", true);
    valid.isObjValid(payload.data, "acl", "E20048BE", true);

    payload.data.fullname = payload.data.fullname.trim();

    await POSTValidationFullname();

    // validate msr_token
    if (payload.data.msr_token) {
      if (
        payload.data.msr_token.substr(payload.data.msr_token.length - 1) ===
        "\n"
      ) {
        payload.data.msr_token = payload.data.msr_token.slice(0, -1);
      }
      //validate msr_token is not used in one outlet
      await POSTValidateDuplicateMsrNumber();
      validationMsrIdentity();
    }

    // validasi username dan password untuk data baru
    if (!payload.data.id && payload.data.auth_bo) {
      if (!payload.data.username) {
        throw new Error("E20006BE");
      } else if (!payload.data.password) {
        throw new Error("E20010BE");
      }
    }

    if (payload.data.pin) {
      valid.isPIN(payload.data.pin);
    }

    // validate password
    if (payload.data.password) {
      valid.isPassword(payload.data.password);
    }

    //validate username & pin is not used
    await POSTValidateDuplicateUsernameOrPIN();

    // validate ACL list
    POSTValidationACL();
    // validate ACL list ============= end
  };

  const validateUpdateMsr = async () => {
    valid.isObjValid(payload.data, "msr_token", "msr_token required", true);

    const existingMsr = await db
      .collection(collectionNames.user_credentials)
      .aggregate([
        {
          $match: { id_user: BSON.ObjectId(payload.filter.id) },
        },
        {
          $lookup: {
            from: "user_credentials",
            let: { outlet_id: "$outlet" },
            pipeline: [
              {
                $match: {
                  msr_token: payload.data.msr_token,
                  outlet: "$$outlet_id",
                  id_user: { $ne: BSON.ObjectId(payload.filter.id) },
                },
              },
              {
                $project: {
                  _id: 1,
                },
              },
            ],
            as: "credentials",
          },
        },
        {
          $project: {
            // _id: 1,
            credentials: 1,
            exist: {
              $cond: {
                if: { $eq: [{ $size: "$credentials" }, 0] },
                then: false,
                else: true,
              },
            },
          },
        },
      ])
      .toArray();

    if (existingMsr[0].exist) {
      throw new Error("E30120BE");
    }

    return true;
  };

  const validationMsrIdentity = () => {
    const data_payload = payload.data.msr_token.split("=")[0];

    const identity = context.values.get("MSR_IDENTITY");
    if (!identity.find((id) => id === data_payload)) {
      throw new Error("E20221BE");
    }

    return true;
  };

  // ----------- Helper end-------------------------

  // ----------- DB start -----------------
  const UPDATE_PASSWORD_updateUser = async () => {
    const {
      data: { user_id, password },
    } = payload;

    await db.collection(collectionNames.user).updateOne(
      { _id: BSON.ObjectId(user_id.toString()), license: user.license },
      {
        $set: {
          password: valid.hashPassword(password),
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id),
        },
        $inc: { __v: 1 },
      }
    );
  };

  const dbPOSTGetExistingUser = async () => {
    const user_id = BSON.ObjectId(payload.data.id.toString());
    let existingUser = await db
      .collection(collectionNames.user)
      .aggregate([
        {
          $match: { _id: user_id, license: user.license },
        },
        {
          $lookup: {
            from: "user_credentials",
            localField: "credential_id",
            foreignField: "_id",
            as: "credential",
          },
        },
        {
          $unwind: "$credential",
        },
        {
          $lookup: {
            from: "user_acl",
            localField: "credential.acl",
            foreignField: "_id",
            as: "user_acl",
          },
        },
        {
          $unwind: "$user_acl",
        },
        {
          $project: {
            _id: 1,
            credential: {
              _id: 1,
              acl: 1,
              pin: 1,
              username: 1,
              msr_token: 1,
            },
            user_acl: 1,
          },
        },
      ])
      .toArray();

    return existingUser[0];
  };

  const dbGETUserDetail = () => {
    return db
      .collection(collectionNames.user)
      .aggregate([
        {
          $match: {
            _id: BSON.ObjectId(user._id.toString()),
            license: user.license,
          },
        },
        {
          $lookup: {
            from: "user_license",
            localField: "license",
            foreignField: "_id",
            as: "license",
          },
        },
        {
          $lookup: {
            from: "user_credentials",
            let: { credential_id: "$credential_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$credential_id"] } } },
              {
                $lookup: {
                  from: "outlet",
                  localField: "outlet",
                  foreignField: "_id",
                  as: "outlet",
                },
              },
              {
                $unwind: "$outlet",
              },
              {
                $project: {
                  _id: 1,
                  outlet: { _id: 1, name: 1, xendit_active: 1 },
                },
              },
            ],
            as: "list_outlet_id",
          },
        },
        {
          $project: {
            _id: 1,
            fullname: 1,
            phone: 1,
            username: 1,
            type: 1,
            email: 1,
            identity_url: 1,
            media_social_link: 1,
            nik: 1,
            list_outlet_id: {
              _id: 1,
              outlet: 1,
            },
          },
        },
      ])
      .toArray();
  };

  const dbGET_DETAILUserWithACL = () => {
    const { filter } = payload;
    return db
      .collection(collectionNames.user)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: "user_credentials",
            let: { credential_id: "$credential_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$credential_id"] } } },
              {
                $lookup: {
                  from: "outlet",
                  localField: "outlet",
                  foreignField: "_id",
                  as: "outlet",
                },
              },
              {
                $unwind: "$outlet",
              },
              {
                $lookup: {
                  from: "user_acl",
                  localField: "acl",
                  foreignField: "_id",
                  as: "acl",
                },
              },
              {
                $unwind: "$acl",
              },
              {
                $project: {
                  _id: 1,
                  outlet: { _id: 1, name: 1 },
                  acl: 1,
                  pin: 1, // tidak di tampilkan, untuk validasi key auth_pos
                  msr_token: 1, // tidak di tampilkan, untuk validasi msr_exist
                },
              },
              {
                $project: {
                  acl: {
                    _id: 0,
                    _partition: 0,
                    __v: 0,
                    user_id: 0,
                    outlet: 0,
                    license: 0,
                    active: 0,
                    createdAt: 0,
                    updatedAt: 0,
                    createdBy: 0,
                    updatedBy: 0,
                  },
                },
              },
            ],
            as: "user_credential",
          },
        },
        {
          $unwind: "$user_credential",
        },
        {
          $project: {
            _id: 1,
            fullname: 1,
            username: 1,
            type: 1,
            phone: 1,
            active: 1,
            image_url: 1,
            user_credential: 1,
          },
        },
      ])
      .toArray();
  };

  const dbUPDATE_PINGetDuplicate = async () => {
    const getDuplicate = await context.functions.execute(
      "intSystemQuery",
      collectionNames.user_credentials,
      [
        {
          $match: {
            // seharusnya query ini di pisah
            // karena query ini untuk membatasi user yang memiliki pin saja
            // tapi saat buat code ini, method UPDATE_PIN hanya digunakan untuk user OWNER
            // jika nanti dibuka untuk semua user, bukan owner saja,
            // perlu di update semua query-nya
            id_user: { $ne: BSON.ObjectId(user._id.toString()) },
            pin: { $exists: true },
            license: user.license,
          },
        },
        {
          $lookup: {
            as: "cred",
            from: "user_credentials",
            let: { outlet_id: "$outlet" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$outlet", "$$outlet_id"] },
                      { $eq: ["$pin", payload.data.new_pin] },
                      { $eq: ["$license", user.license] },
                    ],
                  },
                },
              },
              { $project: { pin: 1, _id: 1 } },
            ],
          },
        },
        {
          $unwind: "$cred",
        },
        {
          $project: {
            _id: 1,
          },
        },
      ]
    );

    return getDuplicate.length > 0;
  };

  const dbUPDATE_PINSaveNewPIN = () => {
    return db.collection(collectionNames.user_credentials).updateOne(
      {
        id_user: payload.filter._id,
        license: user.license,
      },
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id.toString()),
          pin: payload.data.new_pin,
        },
        $inc: { __v: 1 },
      }
    );
  };

  /*
    memisahkan duplicate PIN karena duplicateUsernameAndPIN
    memvalidsi global data untuk username and phone
    sedangkan untuk pin harus ada outlet
  */
  const dbPOSTFindDuplicatePIN = () => {
    let filter = { $and: [] };

    if (payload.data.pin) {
      filter["$and"].push({
        pin: { $eq: payload.data.pin },
        outlet: BSON.ObjectId(payload.data.outlet_id.toString()),
        license: user.license,
      });

      if (payload.data.id) {
        filter["$and"].push({
          id_user: { $ne: BSON.ObjectId(payload.data.id) },
        });
      }
    }

    if (filter["$and"].length != 0) {
      return db
        .collection(collectionNames.user_credentials)
        .aggregate([
          {
            $match: filter, // no need license because query to global data
          },
          {
            $project: {
              _id: 1,
              msr_token: 1,
              outlet: 1,
              pin: 1,
            },
          },
        ])
        .toArray();
    }

    return [];
  };

  const dbPOSTFindDuplicateUsername = () => {
    if (payload.data.id) {
      return [];
    }

    let filter = { $or: [] };
    if (payload.data.username) {
      filter["$or"].push({ username: { $eq: payload.data.username } });
    }

    filter["$or"].push({ phone: { $eq: payload.data.phone } });

    if (filter["$or"].length != 0) {
      return context.functions.execute(
        "intSystemQuery",
        collectionNames.user_credentials,
        [
          {
            $match: filter, // no need license because query to global data
          },
          {
            $project: {
              _id: 1,
              username: 1,
              pin: 1,
              phone: 1,
            },
          },
        ]
      );
    }

    return [];
  };

  const dbPOSTFindDuplicateMsrNumber = () => {
    let filter = { $and: [] };

    if (payload.data.msr_token) {
      filter["$and"].push({
        msr_token: { $eq: payload.data.msr_token },
        outlet: BSON.ObjectId(payload.data.outlet_id.toString()),
      });

      // tambah filter id_user saat update user saja
      if (payload.data.id) {
        filter["$and"].push({
          id_user: { $ne: BSON.ObjectId(payload.data.id) },
        });
      }
    }

    if (filter["$and"].length != 0) {
      return db
        .collection(collectionNames.user_credentials)
        .aggregate([
          {
            $match: filter, // no need license because query to global data
          },
          {
            $project: {
              _id: 1,
              msr_token: 1,
              outlet: 1,
            },
          },
        ])
        .toArray();
    }

    return [];
  };

  const dbPOSTUpdateUser = async ({ user_id, data_user }) => {
    // delete __v from update, because update use increment
    delete data_user.__v;
    const updated_data_user = {
      $set: {
        ...data_user,
        phone_confirmed: true,
        email_confirmed: true,
        active: payload.data.active,
        updatedAt: new Date(),
        updatedBy: BSON.ObjectId(user._id.toString()),
      },
      $inc: { __v: 1 },
    };

    if (payload.data.username === "~~~delete~~~") {
      updated_data_user["$unset"] = {
        password: 1,
        username: 1,
      };
      delete data_user.password;
      delete updated_data_user["$set"].username;
      delete updated_data_user["$set"].password;
    } else if (payload.data.password) {
      updated_data_user["$set"].password = valid.hashPassword(
        payload.data.password
      );
    }

    // update user
    await db.collection(collectionNames.user).updateOne(
      {
        _id: user_id,
        license: BSON.ObjectId(user.license.toString()),
      },
      updated_data_user
    );
  };

  const dbPOSTUpdateUserACL = async (existingUser, outlet) => {
    // update user_acl
    await db.collection(collectionNames.user_acl).updateOne(
      {
        _id: BSON.ObjectId(existingUser.credential.acl.toString()),
        license: BSON.ObjectId(user.license.toString()),
      },
      {
        $set: {
          _partition: outlet.toString(),
          outlet: outlet,
          user_id: BSON.ObjectId(user._id.toString()),
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id.toString()),
          ...payload.data.acl,
        },
        $inc: { __v: 1 },
      }
    );
  };

  const dbPOSTUpdateUserCredential = async (
    { outlet, data_user, post_msr },
    existingUser
  ) => {
    // delete __v from update, because update use increment
    delete data_user.__v;

    const updated_data_user_credential = {
      $set: {
        outlet,
        user_id: data_user.user_id,
        fullname: data_user.fullname,
        image_url: data_user.image_url,
        phone: data_user.phone,
        active: payload.data.active,
        updatedAt: new Date(),
        updatedBy: BSON.ObjectId(user._id.toString()),
      },
      $inc: { __v: 1 },
    };

    if (payload.data.username === "~~~delete~~~") {
      updated_data_user_credential["$unset"] = {
        username: 1,
      };
    } else {
      updated_data_user_credential["$set"].username = payload.data.username;
    }

    if (payload.data.pin === "~~~delete~~~") {
      if (!updated_data_user_credential["$unset"]) {
        updated_data_user_credential["$unset"] = {};
      }

      updated_data_user_credential["$unset"].pin = 1;
    } else if (payload.data.pin) {
      updated_data_user_credential["$set"].pin = payload.data.pin;
    }

    if (post_msr.msr_token) {
      updated_data_user_credential["$set"].msr_token = post_msr.msr_token;
    }

    // update user user_credentials
    await db.collection(collectionNames.user_credentials).updateOne(
      {
        _id: BSON.ObjectId(existingUser.credential._id.toString()),
        license: user.license,
      },
      updated_data_user_credential
    );
  };

  const dbPOSTCreateUser = async ({
    data_user,
    by,
    user_id,
    credential_id,
  }) => {
    // prepare data user
    const user_to_save = {
      ...data_user,
      ...by,
      _id: user_id,
      _partition: "",
      type: "staff",
      email: payload.data.username,
      password: valid.hashPassword(payload.data.password),
      phone_confirmed: true,
      email_confirmed: true,
      credential_id,
    };

    // create user
    await db.collection(collectionNames.user).insertOne(user_to_save);
  };

  const dbPOSTCreateUserACL = async ({ user_acl_id, outlet, by }) => {
    // create user_acl
    await db.collection(collectionNames.user_acl).insertOne({
      _id: user_acl_id,
      _partition: outlet.toString(),
      outlet,
      ...by,
      ...payload.data.acl,
    });
  };

  const dbPOSTCreateUserCredential = async ({
    credential_id,
    outlet,
    user_id,
    data_user,
    by,
    user_acl_id,
    post_msr,
  }) => {
    // create user_credentials
    await db.collection(collectionNames.user_credentials).insertOne({
      _id: credential_id,
      _partition: outlet.toString(),
      outlet: outlet,
      acl: user_acl_id,
      pin: payload.data.pin,
      id_user: user_id,
      ...data_user,
      ...by,
      ...post_msr,
    });
  };

  const updateMsr = () => {
    return db.collection(collectionNames.user_credentials).updateOne(
      {
        id_user: BSON.ObjectId(payload.filter.id),
        license: user.license,
      },
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id.toString()),
          msr_token: payload.data.msr_token,
        },
        $inc: { __v: 1 },
      }
    );
  };

  // ----------- DB end -----------------

  return Object.freeze({
    GET,
    LIST,
    GET_DETAIL,
    POST,
    ACTIVE,
    UPDATE_PASSWORD,
    UPDATE_PIN,
    UPDATE_MSR,
  });
};
