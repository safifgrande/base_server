module.exports = async ({ id, license }) => {
  try {
    const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
    const db = mongodb.db(context.values.get("DB_NAME"));
    const { transaction } = context.values.get("COLLECTION_NAMES");

    const get_data = await getDetailInvoice(db, transaction, { id, license });

    return formatingGetReturn(get_data);
  } catch (error) {
    context.functions.execute(
      "handleCatchError",
      error,
      "",
      "intTransactionInvoiceDetail"
    );

    throw new Error(error.message);
  }
};

const formatingGetReturn = (data) => {
  const ret = data[0];

  ret.id = ret._id.toString();
  ret.sub_total = ret.sub_total_before_discount;
  delete ret._id;
  delete ret.sub_total_before_discount;

  ret.outlet_id = ret.outlet._id.toString();
  delete ret.outlet._id;

  ret.member.id = ret.member._id.toString();
  delete ret.member._id;

  ret.credit_detail.id = ret.credit_detail._id.toString();
  delete ret.credit_detail._id;

  ret.credit_detail.invoice_payment_history =
    ret.credit_detail.invoice_payment_history.reduce((prev, next) => {
      next.invoice_payment = next.invoice_payment.map((obj) => {
        obj.id = obj._id.toString();
        delete obj._id;

        return obj;
      });

      prev = [...prev, ...next.invoice_payment];
      return prev;
    }, []);

  ret.list_taxes = [];
  ret.total_qty = 0;
  ret.transaction_detail = ret.transaction_detail.map((trans) => {
    trans.id = trans._id.toString();
    delete trans._id;

    trans.items = trans.items.map((item) => {
      ret.total_qty += item.qty;
      item.id = item._id.toString();
      item.total = item.total_before_discount;
      delete item._id;
      delete item.total_before_discount;

      if (item.package_items) {
        item.is_package = true;
        item.package_items = item.package_items.map((pItem) => {
          pItem.id = pItem._id.toString();
          pItem.total = pItem.total_before_discount;
          delete pItem._id;
          delete pItem.total_before_discount;

          return pItem;
        });
      }

      return item;
    });

    ret.list_taxes.push(...trans.tax);
    delete trans.tax;

    return trans;
  });

  // check list taxes if has tax_id exist in prev -> merge the tax and sum the nominal
  ret.list_taxes = ret.list_taxes.reduce((prev, curr) => {
    curr.tax = curr.tax.toString();
    curr.id = curr._id.toString();
    delete curr._id;

    const existIndex = prev.findIndex((v) => v.tax == curr.tax);

    if (existIndex > -1) {
      prev[existIndex].nominal = prev[existIndex].nominal + curr.nominal;

      return prev;
    }

    return [...prev, curr];
  }, []);

  return ret;
};

const getDetailInvoice = async (db, transaction, { id: _id, license }) => {
  return await db
    .collection(transaction)
    .aggregate([
      {
        $match: {
          _id,
          license,
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
              $group: {
                _id: "$_id",
                name: { $first: "$name" },
                address: { $first: "$address" },
                city: { $first: "$city.name" },
                business: { $first: "$business.name" },
                image: { $first: "$image_url" },
                phone_number: { $first: "$phone_number" },
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
                address: 1,
                city: 1,
                business: 1,
                image: 1,
                phone_number: 1,
              },
            },
          ],
        },
      },
      {
        $unwind: "$outlet",
      },
      {
        $lookup: {
          from: "member",
          localField: "member",
          foreignField: "_id",
          as: "member",
        },
      },
      {
        $unwind: "$member",
      },
      {
        $lookup: {
          from: "transaction_payment",
          let: { payment: "$payment" },
          pipeline: [
            {
              $match: { $expr: { $in: ["$_id", "$$payment"] } },
            },
            {
              $lookup: {
                from: "invoice_payment_history",
                let: { payment_id: "$_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$transaction_payment_id", "$$payment_id"],
                      },
                    },
                  },
                  {
                    $lookup: {
                      from: "invoice_payment",
                      let: { invoice_payment: "$invoice_payment" },
                      pipeline: [
                        {
                          $match: {
                            $expr: { $eq: ["$_id", "$$invoice_payment"] },
                          },
                        },
                        {
                          $project: {
                            _id: 1,
                            nominal: 1,
                            paidNominal: 1,
                            memo: 1,
                            invoice_payment_number: 1,
                            payment_media_name: 1,
                            createdAt: 1,
                          },
                        },
                      ],
                      as: "invoice_payment",
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      invoice_payment: 1,
                    },
                  },
                ],
                as: "invoice_payment_history",
              },
            },
            {
              $project: {
                _id: 1,
                due_date: 1,
                createdAt: 1,
                invoice_ammount_due: 1,
                invoice_total_payment: 1,
                invoice_payment_history: 1,
              },
            },
          ],
          as: "credit_detail",
        },
      },
      {
        $unwind: "$credit_detail",
      },
      {
        $lookup: {
          from: "transaction_detail",
          let: { detail: "$transaction_detail" },
          pipeline: [
            {
              $match: { $expr: { $in: ["$_id", "$$detail"] } },
            },
            {
              $lookup: {
                from: "transaction_item",
                let: { items: "$items" },
                pipeline: [
                  {
                    $match: { $expr: { $in: ["$_id", "$$items"] } },
                  },
                  {
                    $lookup: {
                      as: "package_items",
                      foreignField: "_id",
                      localField: "package_items",
                      from: "transaction_item",
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      name: 1,
                      price: 1,
                      qty: 1,
                      total_before_discount: 1,
                      total: 1,
                      package_items: {
                        _id: 1,
                        name: 1,
                        price: 1,
                        qty: 1,
                        total_before_discount: 1,
                        total: 1,
                      },
                    },
                  },
                ],
                as: "items",
              },
            },
            {
              $lookup: {
                from: "transaction_taxes",
                let: { tax: "$tax" },
                pipeline: [
                  {
                    $match: { $expr: { $in: ["$_id", "$$tax"] } },
                  },
                  {
                    $project: {
                      _id: 1,
                      tax: 1,
                      name: 1,
                      nominal: 1,
                    },
                  },
                ],
                as: "tax",
              },
            },
            {
              $project: {
                _id: 1,
                type_sales_name: 1,
                tax: 1,
                total: 1,
                items: 1,
              },
            },
          ],
          as: "transaction_detail",
        },
      },
      {
        $project: {
          _id: 1,
          invoice_status: 1,
          bill_number: 1,
          sub_total_before_discount: 1,
          total: 1,
          refund_date: "$updatedAt",
          member: {
            _id: 1,
            name: 1,
            member_id: 1,
            phone: 1,
            email: 1,
            address: 1,
          },
          outlet: {
            _id: 1,
            name: 1,
            address: 1,
            city: 1,
            business: 1,
            image: 1,
            phone_number: 1,
          },
          credit_detail: {
            _id: 1,
            invoice_ammount_due: 1,
            invoice_total_payment: 1,
            invoice_payment_history: {
              _id: 1,
              invoice_payment: {
                _id: 1,
                nominal: 1,
                paidNominal: 1,
                memo: 1,
                invoice_payment_number: 1,
                payment_media_name: 1,
                createdAt: 1,
              },
            },
            due_date: 1,
            createdAt: 1,
          },
          transaction_detail: {
            _id: 1,
            type_sales_name: 1,
            tax: {
              _id: 1,
              tax: 1,
              name: 1,
              nominal: 1,
            },
            total: 1,
            items: {
              _id: 1,
              name: 1,
              price: 1,
              qty: 1,
              total_before_discount: 1,
              total: 1,
              package_items: {
                _id: 1,
                name: 1,
                price: 1,
                qty: 1,
                total_before_discount: 1,
                total: 1,
              },
            },
          },
        },
      },
    ])
    .toArray();
};
