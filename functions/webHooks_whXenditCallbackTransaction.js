// This function is the webhook's request handler.
exports = async function (payload) {
  try {
    const body = EJSON.parse(payload.body.text());
    const func = generalFunction(body);


    const xenditTransDetail = await func.fetchXenditTransDetail();

    // update status
    await func.updateStatus(xenditTransDetail);
  } catch (e) {
    context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "whXenditCallbackTransaction"
    );
  }

  return true;
};

const generalFunction = ({ data, business_id: xendit_id }) => {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const ref_id = data.reference_id;
  const license = data.metadata.license;

  // update status payment pending
  const updateStatus = async (xenditTransDetail) => {
    let body_set = {
      ...xenditTransDetail,
    };

    /*
      [PENDING, SUCCEEDED, FAILED, VOIDED, REFUNDED]
    */
    switch (data.status) {
      case "SUCCEEDED":
      case "COMPLETED":
        body_set.status = "paid";
        body_set.xendit_status = data.status;
        break;
      case "FAILED":
        body_set.status = "cancel";
        body_set.xendit_status = data.status;
        body_set.reason = data.failure_code;
        break;
      default:
        body_set.status = "cancel";
    }

    const data_ewallet_gate = await db.collection(collectionNames.ewallet_gateway).findOne({
      _id: BSON.ObjectId(ref_id),
      license: BSON.ObjectId(license)
    }, {
      status: 1,
      createdAt: 1
    })

    // paid , tidak usah di process
    if (data_ewallet_gate?.status !== "paid") {
      const currentDate = new Date();
      const now = currentDate.getTime() / 1000;
      const second = now - new Date(data_ewallet_gate.createdAt).getTime() / 1000;

      if (second >= 90 && data_ewallet_gate.status == "pending") {
        body_set.status = "cancel"
      }

      await db.collection(collectionNames.ewallet_gateway).updateOne(
        {
          _id: BSON.ObjectId(ref_id),
          license: BSON.ObjectId(license),
        },
        {
          $set: body_set,
          $inc: { __v: 1 },
        }
      );
    }
  };

  const fetchXenditTransDetail = async () => {
    const key = context.environment.values.XENDIT_PRIVATE_KEY;
    const url =
      context.environment.values.XENDIT_API_URL +
      `transactions?reference_id=${ref_id}`;

    const res = await context.http.get({
      url,
      headers: {
        "Content-Type": ["application/json"],
        Accept: ["application/json"],
        Authorization: [`Basic ${BSON.Binary.fromText(key).toBase64()}`],
        "for-user-id": [xendit_id],
      },
    });

    const respTransBody = EJSON.parse(res.body.text());

    if (res.statusCode != 200) {
      throw new Error(respTransBody.errors[0].messages);
    }

    // parse body create qr
    const {
      data: [transDetail],
    } = respTransBody;

    if (!transDetail) {
      return {
        xendit_trans_id: data.id,
        xendit_business_id: xendit_id
      }
    }

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
  };

  return Object.freeze({
    updateStatus,
    fetchXenditTransDetail,
  });
};
