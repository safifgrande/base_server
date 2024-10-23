module.exports = async function (payload) {
  try {
    const body = EJSON.parse(payload.body.text());
    if (!body.transaction_id) throw new Error("E20106BE");

    const handler = mainHandler(body);

    // 1. get transaction
    console.log("trans");
    const trans = await handler.dbGetTransaction();
    if (!trans) return false;

    // 2. build response
    console.log("buildResponse");
    return await handler.buildResponse(trans);
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "webhook_clientGetViewBill"
    );
  }
};

const mainHandler = (body) => {
  const transaction_id = BSON.ObjectId(body.transaction_id);
  const collTransaction = context.services
    .get("mongodb-atlas")
    .db("CORE_DB")
    .collection("transaction");

  // Database ================================
  const dbGetTransaction = async () => {
    const trans = await collTransaction
      .aggregate([
        {
          $match: {
            _id: transaction_id,
          },
        },
        {
          $lookup: {
            from: "outlet",
            let: { oi: "$outlet" },
            as: "outlet",
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$oi"] } } },
              {
                $lookup: {
                  from: "master_reg_city",
                  localField: "city",
                  foreignField: "_id",
                  as: "city",
                },
              },
              { $unwind: "$city" },
              {
                $lookup: {
                  from: "user_business",
                  localField: "business_id",
                  foreignField: "_id",
                  as: "business",
                },
              },
              { $unwind: "$business" },
              {
                $lookup: {
                  from: "bill_design",
                  localField: "_id",
                  foreignField: "outlet",
                  as: "bill",
                },
              },
              {
                $unwind: "$bill",
              },
              {
                $group: {
                  _id: "$_id",
                  name: { $first: "$name" },
                  address: { $first: "$address" },
                  city: { $first: "$city.name" },
                  business: { $first: "$business.name" },
                  logo: { $first: "$bill.image_url" },
                  footer_memo: { $first: "$bill.memo" },
                  phone_number: { $first: "$phone_number" },
                },
              },
            ],
          },
        },
        {
          $project: {
            outlet: 1,
            table_name: 1,
            name: 1,
            member: 1,
            bill_number: 1,
            operator: 1,
            date_open: 1,
            date_closed: 1,
            transaction_detail: 1,
            payment: 1,
            status: 1,
            discount_item: 1,
            discount_name: 1,
            discount_nominal: 1,
            sub_total_before_discount: 1,
            total: 1,
            emailDestination: 1,
            license: 1,
            promo_name: 1,
            promo_nominal: 1,
          },
        },
        {
          $unwind: "$outlet",
        },
        {
          $lookup: {
            from: "transaction_detail",
            let: { td: "$transaction_detail" },
            as: "transaction_detail",
            pipeline: [
              { $match: { $expr: { $in: ["$_id", "$$td"] } } },
              {
                $project: {
                  items: 1,
                  tax: 1,
                  sub_total: 1,
                  total: 1,
                  type_sales_name: 1,
                },
              },
              {
                $lookup: {
                  from: "transaction_taxes",
                  let: { taxes: { $ifNull: ["$tax", []] } },
                  as: "tax",
                  pipeline: [
                    { $match: { $expr: { $in: ["$_id", "$$taxes"] } } },
                    {
                      $project: {
                        nominal: 1,
                        name: 1,
                      },
                    },
                  ],
                },
              },
              {
                $lookup: {
                  from: "transaction_item",
                  let: { ti: "$items" },
                  as: "items",
                  pipeline: [
                    { $match: { $expr: { $in: ["$_id", "$$ti"] } } },

                    {
                      $lookup: {
                        from: "transaction_item",
                        as: "package_items",
                        let: { pi: { $ifNull: ["$package_items", []] } },
                        pipeline: [
                          {
                            $match: {
                              $expr: { $in: ["$_id", "$$pi"] },
                              is_package_item: true,
                            },
                          },
                          {
                            $project: {
                              _id: 1,
                              name: 1,
                              qty: 1,
                            },
                          },
                        ],
                      },
                    },
                    {
                      $group: {
                        _id: "$_id",
                        name: { $first: "$name" },
                        price: { $first: "$total_before_discount" }, //price * qty get from total_before_discount
                        qty: { $first: "$qty" },
                        is_package_item: { $first: "$is_package_item" },
                        item_id: { $first: "$item_id" },
                        type: { $first: "$type" },
                        ref_id: { $first: "$ref_id" },
                        modifier: { $first: "$modifiers" },
                        memo: { $first: "$memo" },
                        package_items: { $first: "$package_items" },
                        discount_nominal: { $first: "$discount_nominal" },
                        discount_name: { $first: "$discount_name" },
                        promo_name: { $first: "$promo_name" },
                        promo_nominal: { $first: "$promo_nominal" },
                        createdAt: { $first: "$createdAt" },
                      },
                    },
                    {
                      $project: {
                        _id: 1,
                        name: 1,
                        price: 1,
                        qty: 1,
                        is_package_item: 1,
                        item_id: 1,
                        type: 1,
                        ref_id: 1,
                        modifier: 1,
                        memo: 1,
                        package_items: 1,
                        discount_nominal: 1,
                        discount_name: 1,
                        promo_name: 1,
                        promo_nominal: 1,
                        createdAt: 1,
                      },
                    },
                    { $sort: { createdAt: 1 } },
                  ],
                },
              },
            ],
          },
        },
        {
          $lookup: {
            from: "transaction_payment",
            let: {
              tp: { $ifNull: ["$payment", []] },
              trs_id: "$_id",
              license: "$license",
            },
            as: "payment",
            pipeline: [
              { $match: { $expr: { $in: ["$_id", "$$tp"] } } },
              {
                $lookup: {
                  from: "ewallet_gateway",
                  // let: {trs_id: "$$trs_id"},
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $eq: ["$transaction_id", "$$trs_id"] },
                            { $eq: ["$license", "$$license"] },
                            { $eq: ["$status", "paid"] },
                          ],
                        },
                      },
                    },
                    {
                      $lookup: {
                        from: "outlet",
                        let: {
                          id: "$outlet",
                        },
                        pipeline: [
                          {
                            $match: {
                              $expr: {
                                $eq: ["$outlet", "$$id"],
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
                        xendit_trans_id: 1,
                        xendit_id: "$outlet.xendit_id",
                      },
                    },
                  ],
                  as: "ewallet_gateway",
                },
              },
              {
                $unwind: {
                  path: "$ewallet_gateway",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $project: {
                  paidNominal: 1,
                  changeNominal: 1,
                  nominal: 1,
                  name: 1,
                  memo: 1,
                  ewallet_gateway: {
                    $cond: [
                      { $eq: ["$ewallet_gateway", null] },
                      { $literal: "" },
                      "$ewallet_gateway",
                    ],
                  },
                },
              },
            ],
          },
        },
        {
          $lookup: {
            from: "member",
            let: { me: "$member" },
            as: "member",
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$me"] } } },
              {
                $project: {
                  member_id: 1,
                  name: 1,
                  expiry_date: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$member",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "user",
            let: { op: "$operator" },
            as: "operator",
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$op"] } } },
              {
                $project: {
                  _id: 1,
                  fullname: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$operator",
            preserveNullAndEmptyArrays: true,
          },
        },
      ])
      .toArray();

    if (trans.length === 0) return false;
    return trans[0];
  };

  // helper ==================================
  const buildResponse = async (trans) => {
    const response = {};
    const { _id, ...outlet } = trans.outlet;
    const { taxes, orders } = buildOrdersAndTaxes(trans.transaction_detail);
    let discount_item = trans.discount_item
      ? { title: "Discount Item", value: -trans.discount_item }
      : {};
    let discount_bill = trans.discount_nominal
      ? { title: trans.discount_name, value: -trans.discount_nominal }
      : {};
    let promo = trans.promo_nominal
      ? { title: trans.promo_name, value: -trans.promo_nominal }
      : {};

    response.outlet = outlet;
    response.transaction = {
      table_name: trans.table_name ?? trans.name,
      bill_number: trans.bill_number,
      member_id: trans.member ? trans.member.member_id : "",
      member_name: trans.member ? trans.member.name : "",
      member_expired: trans.member ? trans.member.expiry_date : "", // need to parse
      operator: trans.operator.fullname,
      start: trans.date_open,
      end: trans.date_closed,
      status: trans.status,
      payment: {
        total: trans.total,
        media: await buildPaymentMedia(trans.payment),
      },
      charge: [
        { title: "SUBTOTAL", value: trans.sub_total_before_discount },
        discount_item,
        discount_bill,
        promo,
        ...taxes,
      ],
      orders,
    };
    // hapus object kosong di transaction charge
    response.transaction.charge = response.transaction.charge.filter((el) => {
      if (Object.keys(el).length !== 0) {
        return true;
      }

      return false;
    });

    const change = trans.payment.reduce(
      (sum, { changeNominal }) => sum + changeNominal ?? 0,
      0
    );
    if (change) response.transaction.payment.change = change;

    return response;
  };

  const buildPaymentMedia = async (payment) => {
    return Promise.all(
      payment.map(
        async ({ name: title, paidNominal: value, memo, ewallet_gateway }) => {
          if (ewallet_gateway) {
            value =
              (await getXenditTransactionAmount(ewallet_gateway)) || value;
          }

          return {
            title,
            value,
            memo,
          };
        }
      )
    );
  };

  const getXenditTransactionAmount = async (ewallet_gateway) => {
    const url =
      context.environment.values.XENDIT_API_URL +
      "transactions/" +
      ewallet_gateway.xendit_trans_id;
    const key = context.environment.values.XENDIT_PRIVATE_KEY;

    const xenditTransaction = await context.http.get({
      url: url,
      headers: {
        "Content-Type": ["application/json"],
        Accept: ["application/json"],
        Authorization: [`Basic ${BSON.Binary.fromText(key).toBase64()}`],
        "for-user-id": [ewallet_gateway.xendit_id],
      },
    });
    if (xenditTransaction.statusCode !== 200) {
      return;
    }

    const response = EJSON.parse(xenditTransaction.body.text());

    return response?.amount || 0;
  };

  const buildOrdersAndTaxes = (trans_detail) => {
    return trans_detail.reduce(
      ({ taxes, orders }, val) => {
        const newOrders = { ...orders };
        // logic untuk jaga2 kalau ada type sales yang belum kebentuk di accumulator
        if (!newOrders[val.type_sales_name])
          newOrders[val.type_sales_name] = [];

        newOrders[val.type_sales_name] = buildOrderItems(val.items);

        return {
          taxes: [...loopTaxes(val.tax, taxes)],
          orders: { ...newOrders },
        };
      },
      { taxes: [], orders: {} }
    );
  };

  const loopTaxes = (taxes, acc) => {
    return taxes.reduce((temp, { name: title, nominal: value }) => {
      // mencari existing data dalam accumulator
      const existingIndex = temp.findIndex((v) => v.title === title);

      // jika tidak ketemnu di tambahkan data baru
      if (existingIndex === -1) return [...temp, { title, value }];

      // jika ketemua di jumlahkan
      const newTemp = [...temp];
      newTemp[existingIndex].value += value;
      return newTemp;
    }, acc);
  };

  const buildOrderItems = (items) => {
    return items.map(
      ({
        name: product,
        qty,
        price,
        modifier,
        memo: note,
        package_items,
        discount_nominal,
        discount_name,
        promo_name,
        promo_nominal,
      }) => {
        if (package_items) {
          package_items = package_items.map(({ name: product, ...res }) => ({
            product,
            ...res,
          }));
        }

        return {
          qty,
          product,
          price,
          modifier: modifier || [],
          note,
          discount_name,
          discount_nominal,
          promo_name,
          promo_nominal,
          package_items: package_items || [],
        };
      }
    );
  };

  return Object.freeze({
    dbGetTransaction,
    buildResponse,
  });
};
