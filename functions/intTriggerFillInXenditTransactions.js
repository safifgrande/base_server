module.exports = async () => {
  try {
    const handler = new Handler();
    // 1. find not settled ewallet gateway

    await handler.getEwalletGateway();
    // 2. recursive fetch to xendit

    await handler.getXenditTransactionsAndBuildQuery();
    // 3. update ewallet gateway
    await handler.updateEwalletGateway();

    return true;
  } catch (e) {
    context.functions.execute(
      "handleCatchError",
      e,
      "",
      "intTriggerFillInXenditTransactions"
    );

    throw new Error(e.message);
  }
};

class Handler {
  ewalletGateways = [];
  ewalletGatewayQuerys = [];

  db = context.services
    .get(context.values.get("CLUSTER_NAME"))
    .db(context.values.get("DB_NAME"));
  collectionNames = context.values.get("COLLECTION_NAMES");

  async getEwalletGateway() {
    this.ewalletGateways = await this.db
      .collection(this.collectionNames.ewallet_gateway)
      .aggregate([
        {
          $match: {
            $or: [
              { xendit_settlement_status: "PENDING" },
              {
                $and: [
                  {
                    xendit_trans_id: { $exists: false },
                  },
                  {
                    xendit_settlement_status: { $ne: "FAILED" },
                  },
                ],
              },
            ],
          },
        },
        {
          $lookup: {
            from: "outlet",
            let: { id: "$outlet" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ["$_id", "$$id"],
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  xendit_id: 1,
                },
              },
            ],
            as: "outlet",
          },
        },
        {
          $unwind: "$outlet",
        },
        {
          $project: {
            _id: 0,
            id: { $toString: "$_id" },
            xendit_id: "$outlet.xendit_id",
          },
        },
        {
          $limit: 10,
        },
      ])
      .toArray();
  }

  buildUpdateQuery(ewalletId, response) {
    const {
      data: [detail],
    } = response;

    if (!detail) {
      return {
        updateOne: {
          filter: {
            _id: BSON.ObjectId(ewalletId),
          },
          update: {
            $set: {
              xendit_settlement_status: "FAILED",
            },
          },
        },
      };
    }

    let settlementField = {
      xendit_settlement_status: detail.settlement_status,
      xendit_estimated_settlement_time: new Date(
        detail.estimated_settlement_time
      ),
    };

    if (detail.type == "DISBURSEMENT") {
      settlementField = {
        xendit_settlement_status: "SETTLED",
      };
    }

    return {
      updateOne: {
        filter: {
          _id: BSON.ObjectId(ewalletId),
        },
        update: {
          $set: {
            xendit_trans_id: detail.id,
            xendit_business_id: detail.business_id,
            xendit_type: detail.type,
            xendit_amount: parseFloat(detail.amount),
            xendit_net_amount: parseFloat(detail.net_amount),
            xendit_status: detail.status,
            ...settlementField,
            xendit_xendit_fee: parseFloat(detail.fee.xendit_fee),
            xendit_value_added_tax: parseFloat(detail.fee.value_added_tax),
          },
        },
      },
    };
  }

  async getXenditTransactionsAndBuildQuery() {
    const url = context.environment.values.XENDIT_API_URL;
    const key = context.environment.values.XENDIT_PRIVATE_KEY;

    for (const item of this.ewalletGateways) {
      const param = `/transactions?reference_id=${item.id}`;
      const xenditTransaction = await context.http.get({
        url: url + param,
        headers: {
          "Content-Type": ["application/json"],
          Accept: ["application/json"],
          Authorization: [`Basic ${BSON.Binary.fromText(key).toBase64()}`],
          "for-user-id": [item.xendit_id],
        },
      });

      const response = EJSON.parse(xenditTransaction.body.text());

      if (xenditTransaction.statusCode != 200) {
        continue;
      }

      this.ewalletGatewayQuerys.push(this.buildUpdateQuery(item.id, response));
    }
  }

  async updateEwalletGateway() {
    if (this.ewalletGatewayQuerys.length == 0) {
      return;
    }
    return this.db
      .collection(this.collectionNames.ewallet_gateway)
      .bulkWrite(this.ewalletGatewayQuerys);
  }
}
