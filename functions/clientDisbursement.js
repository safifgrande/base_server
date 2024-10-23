module.exports = async (payload) => {
  try {
    const disbInstance = new DisbursmentFunction(payload);
    disbInstance.authorization();

    const { method } = payload;
    switch (method) {
      case "POST":
        return await disbInstance.POST();
      default:
        throw new Error("Method not found in request");
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientDisbursement"
    );
  }
};

class DisbursmentFunction {
  mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  db = this.mongodb.db(context.values.get("DB_NAME"));
  collectionNames = context.values.get("COLLECTION_NAMES");
  valid = undefined;
  license = undefined;
  user_id = undefined;

  constructor(payload) {
    this.payload = payload;
    this.valid = context.functions.execute("intValidation", payload.data);
  }

  authorization() {
    this.valid.isAuthenticated();
    const { license, _id } = context.functions.execute("intUserContext");
    this.license = license;
    this.user_id = _id;
  }

  // ========== validation ===================
  async _postValidation() {
    const WITHDRAW_TIME_START = 15;
    const WITHDRAW_TIME_END = 22;
    const { data } = this.payload;

    await this.valid.hasPermission(["bo_ewallet"]);

    // karena xendit tidak memprocess transaksi antara jam 00 - 05
    // saya (yuda) putuskan sementara, jam 22 - 05 tidak bisa withdraw
    if (
      WITHDRAW_TIME_START <= new Date().getUTCHours() &&
      new Date().getUTCHours() <= WITHDRAW_TIME_END
    ) {
      throw new Error("E20011BE");
    }

    this.valid.isObjValid(data, "outlet_id", "E20033BE", true);
    this.valid.isObjValid(data, "bank_account_number", "E20208BE", true);

    // bank_account_number hanya boleh di isi angka
    if (!/^[0-9]+$/.test(data.bank_account_number)) {
      throw new Error("E20024BE");
    }

    this._dbValidateBankAccount();
  }

  async _postValidationAmountToWithdraw() {
    const foundedCountry = await this._dbGetCountry();

    if (!foundedCountry) throw new Error("E30032BE");
    const totalXenditFee = foundedCountry.country.generalConfig
      .filter((e) => e.key === "ewalletFee" || e.key === "ewalletVat")
      .reduce((acc, curr) => acc + curr.value, 0);

    const amountIncFee = this.payload.data.amount + totalXenditFee;

    const req_balance = await this._requestBalance(foundedCountry.xendit_id);

    if (amountIncFee > JSON.parse(req_balance.body.text()).balance)
      throw new Error("E20210BE");
  }

  // =========== database ===================
  async _dbValidateBankAccount() {
    const bank_account = await this.db
      .collection(this.collectionNames.user_bank_account)
      .findOne(
        {
          license: this.license,
          account_number: this.payload.data.bank_account_number,
        },
        {
          _id: 1,
          bank_code: 1,
          account_number: 1,
          account_owner: 1,
          bank_name: 1,
        }
      );

    if (!bank_account) throw new Error("E30111BE");
    this.payload.data.bank = bank_account;
  }

  async _dbGetCountry() {
    const [country] = await this.db
      .collection(this.collectionNames.outlet)
      .aggregate([
        {
          $match: {
            _id: BSON.ObjectId(this.payload.data.outlet_id),
          },
        },
        { $project: { country: 1, xendit_id: 1 } },
        {
          $lookup: {
            from: "master_reg_country",
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

    return country;
  }

  async _dbCreateDisbursement() {
    const { data } = this.payload;

    this.disbursement = {
      disb_id: new BSON.ObjectId(),
      ext_id: new BSON.ObjectId(),
    };

    await this.db.collection(this.collectionNames.disbursement).insertOne({
      _id: this.disbursement.disb_id,
      __v: parseInt(0),
      _partition: data.outlet_id.toString(),
      createdAt: new Date(),
      createdBy: BSON.ObjectId(this.user_id),
      license: this.license,
      outlet: BSON.ObjectId(data.outlet_id.toString()),
      external_id: this.disbursement.ext_id.toString(),
      user_id: BSON.ObjectId(this.user_id),
      bank_code: data.bank.bank_code,
      bank_name: data.bank.bank_name,
      account_number: data.bank.account_number.toString(),
      account_owner: data.bank.account_owner,
      amount: parseFloat(data.amount),
      description: data.notes ? data.notes : "",
      status: "pending",
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(this.user_id),
    });
  }

  async _dbCreateEwalletGateway() {
    const { data } = this.payload;

    await this.db.collection(this.collectionNames.ewallet_gateway).insertOne({
      _id: this.disbursement.ext_id,
      _partition: data.outlet_id.toString(),
      __v: parseInt(0),
      amount: parseFloat(data.amount),
      createdAt: new Date(),
      createdBy: BSON.ObjectId(this.user_id),
      action_type: "disbursement",
      license: this.license,
      outlet: BSON.ObjectId(data.outlet_id.toString()),
      qris_code: "",
      reason: "",
      status: "new",
      disbursement_id: this.disbursement.disb_id,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(this.user_id),
      xendit_status: "",
    });
  }

  // =========== http request ===================
  async _requestBalance(xendit_id) {
    const url = context.environment.values.XENDIT_API_URL;
    const key = context.environment.values.XENDIT_PRIVATE_KEY;

    const response = await context.http.get({
      url: url + "balance?account_type=CASH",
      headers: {
        "Content-Type": ["application/json"],
        Accept: ["application/json"],
        Authorization: [`Basic ${BSON.Binary.fromText(key).toBase64()}`],
        "for-user-id": [xendit_id],
      },
    });

    if (response.statusCode > 400) throw new Error("Data not found");

    return response;
  }

  // =========== Public method ===================
  async POST() {
    /*
      exports(
        {
        method: 'POST',
        data: {
          amount : 20000
          bank_account_number: "62710012319",
          outlet_id: "62455629a414a2e32d723d43",
          notes : "Here "
        },
        filter: {}
        }
    )
    */
    await this._postValidation();
    // return false;

    await this._postValidationAmountToWithdraw();

    await this._dbCreateDisbursement();

    await this._dbCreateEwalletGateway();

    return true;
  }
}
