module.exports = async function (payload) {
  try {
    const body = EJSON.parse(payload.body.text());

    // data from type ovo and body from qris dynamic
    const func = generalFunction(body);

    // update status
    await func.updateStatus();
  } catch (e) {
    context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "whXenditCallbackDisbursement"
    );
  }
  return true;
};

const generalFunction = (data) => {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  // update status ewallet gateway
  const updateStatus = async () => {
    const body_set = _helperStatus();
    const get_data_ewallet = await _dbFindEwalletGateway();

    const xendit_trans_detail = await _fetchXenditTransDetail();

    await _dbUpdateEwallet(get_data_ewallet, body_set, xendit_trans_detail);
    await _dbUpdateDisbursment(get_data_ewallet, body_set);
  };

  // Database ===========
  async function _dbUpdateDisbursment(get_data_ewallet, body_set) {
    return db.collection(collectionNames.disbursement).updateOne(
      {
        _id: get_data_ewallet.disbursement_id,
        license: get_data_ewallet.license,
      },
      {
        $set: {
          status: body_set.status,
        },
        $inc: { __v: 1 },
      }
    );
  }

  async function _dbUpdateEwallet(
    get_data_ewallet,
    body_set,
    xendit_trans_detail
  ) {
    return db.collection(collectionNames.ewallet_gateway).updateOne(
      {
        _id: get_data_ewallet._id,
        license: get_data_ewallet.license,
      },
      {
        $set: { ...body_set, ...xendit_trans_detail },
        $inc: { __v: 1 },
      }
    );
  }

  async function _dbFindEwalletGateway() {
    return db.collection(collectionNames.ewallet_gateway).findOne(
      {
        _id: BSON.ObjectId(data.external_id),
      },
      {
        _id: 1,
        disbursement_id: 1,
        license: 1,
      }
    );
  }

  // Helper =============
  function _helperStatus() {
    /*
      [PENDING, SUCCEEDED, FAILED, VOIDED, REFUNDED]
    */
    switch (data.status) {
      case "SUCCEEDED":
      case "COMPLETED":
        return {
          status: "paid",
          xendit_status: data.status,
        };
      case "FAILED":
        return {
          status: "cancel",
          xendit_status: data.status,
          reason: data.failure_code,
        };
      default:
        return false;
    }
  }

  // HTTP ===============
  async function _fetchXenditTransDetail() {
    const { user_id: xendit_id, external_id: ref_id } = data;
    const key = context.environment.values.XENDIT_PRIVATE_KEY;
    const url =
      context.environment.values.XENDIT_API_URL +
      `transactions?reference_id=${ref_id}&types=DISBURSEMENT`;

    const respTransDetail = await context.http.get({
      url,
      headers: {
        "Content-Type": ["application/json"],
        Accept: ["application/json"],
        Authorization: [`Basic ${BSON.Binary.fromText(key).toBase64()}`],
        "for-user-id": [xendit_id], // di disbursment user_id adalah xendit ID
      },
    });

    const respTransBody = EJSON.parse(respTransDetail.body.text());

    if (respTransDetail.statusCode != 200) {
      throw new Error(respTransBody.message);
    }

    const {
      data: [transDetail],
    } = respTransBody;

    return {
      xendit_trans_id: transDetail.id,
      xendit_business_id: transDetail.business_id,
      xendit_type: transDetail.type,
      xendit_amount: transDetail.amount,
      xendit_net_amount: transDetail.net_amount,
      xendit_settlement_status: transDetail.settlement_status,
      xendit_estimated_settlement_time: transDetail.estimated_settlement_time,
      xendit_xendit_fee: transDetail.fee.xendit_fee,
      xendit_value_added_tax: transDetail.fee.value_added_tax,
    };
  }

  return Object.freeze({
    updateStatus,
  });
};
