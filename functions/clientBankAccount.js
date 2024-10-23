module.exports = async (payload) => {
  try {
    const mainHandler = await bankAccount(payload);

    const { method } = payload;
    if (mainHandler[method]) {
      return await mainHandler[method]();
    } else {
      return "method is not exists";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientBankAccount"
    );
  }
};

const bankAccount = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { license } = context.functions.execute("intUserContext");

  // ================ MAIN method start ========================
  /*
    exports({"method":"GET","headers":{"Lang":"id"}})
  */
  const GET = async () => {
    const data = await dbGETBankAccountData();
    if (!data) return {};

    const { _id, ...bank_account } = data;
    return {
      id: _id.toString(),
      ...bank_account,
    };
  };

  // post bank hanya untuk update bank (sementara sampai ada akun multibank).
  /*
    exports({
      method:'POST',
      data: {
        "id": "",
        "bank_code":"BCA",
        "account_number":"62710012317",
        "account_owner":"Safif prik 2"
      }
    })

    1. validate
    2. check bank code and bank name
    3. update bank account
  */
  const POST = async () => {
    // 1. validate
    await postValidation();

    // 2. check bank code and bank name
    const bank_name = POSTFindBankName();

    // 3. update bank account
    return await dbPOSTUpdateBankAccount(bank_name);
  };
  // ================ MAIN method end ==========================

  // ================ Helper start =============================
  const postValidation = async () => {
    const { data } = payload;

    valid.isObjValid(data, "id", "E20216BE", false);
    valid.isObjValid(data, "bank_code", "E20207BE", true);
    valid.isObjValid(data, "account_number", "E20208BE", true);
    valid.isObjValid(data, "account_owner", "E20106BE", true);

    await valid.isUnique(
      data,
      collectionNames.user_bank_account,
      "account_number",
      "E30100BE"
    );
  };

  const POSTFindBankName = () => {
    const {
      data: { bank_code },
    } = payload;
    const bank_codes = context.values.get("CODE_BANKS");

    const bank_data = bank_codes.filter(({ code }) => code === bank_code);

    if (bank_data === 0) throw new Error("E30068BE");

    return bank_data[0].name;
  };
  // ================ Helper end ===============================

  // ================ Database start ===========================
  const dbGETBankAccountData = () => {
    return db.collection(collectionNames.user_bank_account).findOne(
      {
        license,
      },
      {
        bank_code: 1,
        bank_name: 1,
        account_number: 1,
        account_owner: 1,
      }
    );
  };

  const dbPOSTUpdateBankAccount = async (bank_name) => {
    const {
      data: { id, bank_code, account_number, account_owner },
    } = payload;

    await db.collection(collectionNames.user_bank_account).updateOne(
      {
        _id: BSON.ObjectId(id.toString()),
        license,
      },
      {
        $set: {
          bank_code,
          account_number,
          account_owner,
          bank_name,
        },
        $inc: { __v: 1 },
      }
    );

    return id;
  };
  // ================ Database end =============================

  return Object.freeze({ GET, POST });
};
