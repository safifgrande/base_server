module.exports = async (payload) => {
  try {
    const invoiceObject = await invoice(payload);

    const { method } = payload;
    if (invoiceObject[method]) {
      return await invoiceObject[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientInvoice"
    );
  }
};

const invoice = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { license, _id: user_id } = context.functions.execute("intUserContext");

  /* exports({
    "method":"LIST",
    "data":null,
    "filter":{
      "business_id":"610c9df3f8382f00d30acba5",
      "outlet_id":"",
      "payable": false,
    }
  })
  */
  const LIST = async () => {
    // 1. validation LIST and filtering before query
    await LISTValidationAndFilter();

    // 2. get list invoice
    let list_data = await getListInvoice();
    // 3. return LIST Invoice with formating
    return formatReturnList(list_data);
  };

  const formatReturnList = (list_data) => {
    return list_data.map((v) => {
      return {
        id: v._id.toString(),
        bill_number: v.bill_number,
        invoice_status: v.invoice_status,
        //refund_ref: v.refund_ref,
        payment_id: v.payment._id.toString(),
        invoice_ammount_due: v.payment.invoice_ammount_due,
        invoice_total_payment: v.payment.invoice_total_payment,
        nominal: v.payment.nominal,
        paid_nominal: v.payment.paidNominal,
        due_date: v.payment.due_date,
        start_date: v.payment.createdAt,
        outlet_id: v.outlet._id.toString(),
        outlet_name: v.outlet.name,
        member_id: v.member._id.toString(),
        member_number: v.member.member_id,
        member_phone: v.member.phone,
        member_name: v.member.name,
      };
    });
  };

  const LISTValidationAndFilter = async () => {
    const { filter } = payload;

    await valid.hasPermission("bo_invoice");

    if (!filter.business_id) {
      throw new Error("E20110BE");
    }

    filter.license = BSON.ObjectId(license.toString());
    filter.status = "invoice";
    filter.active = true;

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

    // filter untuk hide transaksi dengan sisa tagihan 0
    payload.filterPayable = {};
    if (filter.payable) {
      payload.filterPayable = {
        "payment.invoice_ammount_due": { $gt: 0 },
      };

      filter.invoice_status = { $ne: "refund" };
    }
    delete filter.payable;
  };

  const getListInvoice = async () => {
    const { filter } = payload;
    return db
      .collection(collectionNames.transaction)
      .aggregate([
        {
          $match: {
            ...filter,
          },
        },
        {
          $lookup: {
            from: "transaction",
            localField: "_id",
            foreignField: "refund_ref",
            as: "refund",
          },
        },
        {
          $unwind: {
            path: "$refund",
            preserveNullAndEmptyArrays: true,
          },
        },
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
                $project: {
                  _id: 1,
                  invoice_ammount_due: 1,
                  invoice_last_payment: 1,
                  invoice_total_payment: 1,
                  nominal: 1,
                  paidNominal: 1,
                  pos_id: 1,
                  due_date: 1,
                  type: 1,
                  createdAt: 1,
                },
              },
            ],
            as: "payment",
          },
        },
        {
          $unwind: "$payment",
        },
        {
          $match: {
            ...payload.filterPayable,
          },
        },
        {
          $project: {
            _id: 1,
            bill_number: 1,
            invoice_status: 1,
            updatedAt: 1,
            member: { _id: 1, name: 1, phone: 1, member_id: 1 },
            outlet: { _id: 1, name: 1 },
            payment: 1,
          },
        },
        { $sort: { updatedAt: -1 } },
      ])
      .toArray();
  };

  /*
  exports({
  "method":"POST",
    "data":{
      "payments": [
          "61820edd7ed29d0823ee5c5e"
      ],
      "nominal": 100000,
      "payment_media": "61820e24299641e4e44ca19d",
      "payment_media_name": "Tunai",
      "memo": "ini bayar 2"
    },
    "filter":{}
  })
  */
  const POST = async () => {
    // validation request
    await POSTValidation();

    // get data transaction -> transaction payment from request to formating
    const list_data_invoice = await getDataInvoice();

    // formating data and filtering before insert and update schema
    const dataFormatAndFilter = filteringData(list_data_invoice);

    // get object and find last invoice number in invoice_payment to counter invoice_number
    const getLastInvoiceNumber = await getLastNumber(
      dataFormatAndFilter.list_outlet
    );

    // generate invoice number
    generateInvoiceNumber(
      dataFormatAndFilter.list_invoice_payment,
      getLastInvoiceNumber
    );

    // save and update object from dataFormatAndFilter
    return saveAndUpdateInvoice(dataFormatAndFilter, getLastInvoiceNumber);
  };

  const getDataInvoice = async () => {
    const { data } = payload;

    const payments = data.payments.map((id) => BSON.ObjectId(id.toString()));

    return (
      await db
        .collection(collectionNames.transaction)
        .aggregate([
          {
            $match: {
              _id: { $in: payments },
              license,
            },
          },
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
              from: "transaction_payment",
              let: { payment: "$payment" },
              pipeline: [
                {
                  $match: { $expr: { $in: ["$_id", "$$payment"] } },
                },
                {
                  $project: {
                    _id: 1,
                    invoice_ammount_due: 1,
                    invoice_last_payment: 1,
                    invoice_total_payment: 1,
                    due_date: 1,
                  },
                },
              ],
              as: "payment",
            },
          },
          {
            $unwind: "$payment",
          },
          {
            $project: {
              _id: 1,
              bill_number: 1,
              invoice_status: 1,
              outlet: { _id: 1, name: 1 },
              payment: 1,
            },
          },
        ])
        .toArray()
    ).reduce((prev, curr) => {
      return [
        ...prev,
        {
          id: curr._id,
          payment_id: curr.payment._id,
          bill_number: curr.bill_number,
          invoice_status: curr.invoice_status,
          invoice_ammount_due: curr.payment.invoice_ammount_due,
          invoice_total_payment: curr.payment.invoice_total_payment,
          due_date: curr.payment.due_date,
          outlet_id: curr.outlet._id,
        },
      ];
    }, []);
  };

  const saveAndUpdateInvoice = async (data, last_invoice_numbers) => {
    const {
      list_invoice_history,
      list_invoice_payment,
      update_transaction_list,
      update_invoice_payment,
    } = data;

    //insert invoice_payment_history (detail invoice_payment_detail)
    await db
      .collection(collectionNames.invoice_payment_history)
      .insertMany(list_invoice_history);
    const invoice_payments = await db
      .collection(collectionNames.invoice_payment)
      .insertMany(list_invoice_payment);

    // update data transaction payment
    const transaction_payment = update_invoice_payment.map((obj) => {
      const { _id } = obj;
      delete obj._id;

      return {
        updateOne: {
          filter: {
            _id,
            license,
          },
          update: {
            $set: obj,
            $inc: { __v: 1 },
          },
        },
      };
    });

    await db
      .collection(collectionNames.transaction_payment)
      .bulkWrite(transaction_payment);

    if (update_transaction_list.length > 0) {
      const transaction = update_transaction_list.map((obj) => {
        const { id, invoice_status } = obj;

        return {
          updateOne: {
            filter: {
              _id: id,
              license,
            },
            update: {
              $set: {
                invoice_status,
              },
              $inc: { __v: 1 },
            },
          },
        };
      });

      await db.collection(collectionNames.transaction).bulkWrite(transaction);
    }

    // action send email to all transaction from request
    const payments = list_invoice_history.map((v) =>
      BSON.ObjectId(v.transaction_id.toString())
    );
    await db.collection(collectionNames.transaction).updateOne(
      {
        _id: { $in: payments }, // need license
      },
      {
        $set: {
          sendEmail: false,
        },
        $inc: { __v: 1 },
      }
    );

    return invoice_payments.insertedIds;
  };

  const getLastNumber = async (outlets) => {
    // array bisa kosong karena invoice payment belum tentu ada pembayaran dari outlet tersebut.
    const list_outlet_id = outlets.map((id) => BSON.ObjectId(id.toString()));

    const get_invoice_payment = await db
      .collection(collectionNames.invoice_payment)
      .find(
        {
          outlet: { $in: list_outlet_id },
          invoice_payment_number: { $regex: `PINVBO`, $options: "i" },
          license,
        },
        {
          _id: 1,
          outlet: 1,
          invoice_payment_number: 1,
        },
        { sort: { updatedAt: -1 } }
      )
      .toArray();

    if (get_invoice_payment.length > 1) {
      const filter_invoice_payment = get_invoice_payment.filter(
        (invoice, index) =>
          index ===
          get_invoice_payment.findIndex(
            (other) => invoice.outlet.toString() === other.outlet.toString()
          )
      );

      return filter_invoice_payment;
    }

    return get_invoice_payment;
  };

  const POSTValidation = async () => {
    const { data } = payload;

    valid.isObjValid(data, "nominal", "E20133BE", true);
    valid.isObjValid(data, "payment_media", "E20078BE", true);
    valid.isObjValid(data, "memo", "E20112BE", false);

    // check is invoice transaction exist
    const list_transaction_id = data.payments.map((id) =>
      BSON.ObjectId(id.toString())
    );

    const get_list_id = await db
      .collection(collectionNames.transaction)
      .find(
        {
          _id: { $in: list_transaction_id },
          license,
        },
        {
          _id: 1,
        }
      )
      .toArray();

    if (get_list_id.length !== list_transaction_id.length) {
      throw new Error("E30072BE");
    }

    // check is payment media exist
    await valid.isDataExists(
      collectionNames.payment_medias,
      {
        _id: BSON.ObjectId(data.payment_media.toString()),
        license,
      },
      "E30073BE"
    );
  };

  const filteringData = (list_data_invoice) => {
    const { data } = payload;

    // sorting by close due_date
    const payments = list_data_invoice.sort((a, b) => {
      return new Date(a.due_date) - new Date(b.due_date);
    });
    // make dafault data in schema
    const defaultData = {
      __v: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: BSON.ObjectId(user_id),
      updatedBy: BSON.ObjectId(user_id),
      license: license,
      user_id: BSON.ObjectId(user_id),
    };

    // init varibale to push data invoice_payment, invoice_detail(history), and update transaction payment
    const list_invoice_payment = [];
    const list_invoice_history = [];
    const update_invoice_payment = [];
    const update_transaction_list = [];

    const list_outlet = [];
    let nominal = parseFloat(data.nominal);
    const total_amount_due = parseFloat(
      list_data_invoice.reduce((prev, curr) => {
        return prev + curr.invoice_ammount_due;
      }, 0)
    );

    // check if nominal pay greater than total_amount_due
    if (nominal > total_amount_due) throw new Error("E30089BE");

    // loop every invoice_payment from request
    for (const eachPayment of payments) {
      const amount_due = parseFloat(eachPayment.invoice_ammount_due);

      // process invoice if nominal has remaining nominal payments
      if (nominal !== 0) {
        // new instance invoice_payment_history_id
        const invoice_payment_history_id = new BSON.ObjectId();

        // paidNominal and nominal calculation in each index
        const nominalCalculated = calculateNominal(nominal, amount_due);
        const pay = nominalCalculated.pay;
        nominal = nominalCalculated.nominal;

        // formating obj invoice detail
        const obj_invoice_detail = {
          ...defaultData,
          _partition: eachPayment.outlet_id.toString(),
          outlet: BSON.ObjectId(eachPayment.outlet_id.toString()),
          _id: invoice_payment_history_id,
          nominal: pay,
          transaction_bill_number: eachPayment.bill_number,
          transaction_id: BSON.ObjectId(eachPayment.id.toString()),
          transaction_payment_id: BSON.ObjectId(
            eachPayment.payment_id.toString()
          ),
        };

        // find invoice from list invoice by outlet
        const outlet = eachPayment.outlet_id.toString();
        const find_invoice = list_invoice_payment.findIndex(
          (invPayList) => invPayList.outlet.toString() === outlet
        );

        // if payment invoice existing in list just push invoice_payment_history_id to invoice payment detail
        if (find_invoice != -1) {
          list_invoice_payment[find_invoice].invoice_payment_detail.push(
            invoice_payment_history_id
          );

          obj_invoice_detail.invoice_payment =
            list_invoice_payment[find_invoice]._id;
        } else {
          // condition where invoice_payment by id not existing in list then create new invoice payment
          const invoice_payment_id = new BSON.ObjectId();

          list_invoice_payment.push({
            ...defaultData,
            _id: invoice_payment_id,
            _partition: eachPayment.outlet_id.toString(),
            outlet: BSON.ObjectId(eachPayment.outlet_id.toString()),
            invoice_payment_detail: [invoice_payment_history_id],
            // nominal disini adalah total dari seluruh amount due pada transaksi, artinya transaksi invoice ini
            // adalah total amount due dari invoice yg di pilih pada sisi FE (lihat UI Bayar invoice)
            nominal: total_amount_due,
            paidNominal: parseFloat(data.nominal),
            memo: data.memo,
            payment_media: BSON.ObjectId(data.payment_media.toString()),
            payment_media_name: data.payment_media_name,
            roundingNominal: parseFloat(0),
          });

          // push outlet already in invoice_payment
          list_outlet.push(BSON.ObjectId(eachPayment.outlet_id.toString()));
          obj_invoice_detail.invoice_payment = invoice_payment_id;
        }
        const invoice_ammount_due = amount_due - pay;

        const update_invoice_payment_obj = {
          _id: BSON.ObjectId(eachPayment.payment_id.toString()),
          invoice_ammount_due: invoice_ammount_due,
          invoice_last_payment: new Date(),
          invoice_total_payment:
            parseFloat(eachPayment.invoice_total_payment) + pay,
        };

        // update dari ondue paid
        if (invoice_ammount_due <= 0) {
          update_transaction_list.push({
            id: eachPayment.id,
            invoice_status: "paid",
          });
        }

        // push to object update_invoice to update transaction payment type invoice
        update_invoice_payment.push(update_invoice_payment_obj);

        list_invoice_history.push(obj_invoice_detail);
      }
    }

    return Object.freeze({
      list_invoice_history,
      list_invoice_payment,
      update_invoice_payment,
      update_transaction_list,
      list_outlet,
    });
  };

  const generateInvoiceNumber = async (list_invoice, last_invoice_numbers) => {
    list_invoice.map((inv) => {
      const d = new Date();
      const prefix =
        "PINVBO" +
        d.getDate().toString() +
        ("0" + (d.getMonth() + 1)).slice(-2).toString();

      // find last document from object
      const findLastDoc =
        last_invoice_numbers.length > 0
          ? last_invoice_numbers.find(
              (v) => v.outlet.toString() === inv.outlet.toString()
            )
          : false;

      // if last document is false create counter from 1
      // and if last document is exist counter (+ 1) invoice number
      if (!findLastDoc) {
        // belum pernah ada invoice payment di outlet dan invoice payment mulai dari 0
        inv.invoice_payment_number = prefix + "000000001";
      } else {
        let inv_number = findLastDoc.invoice_payment_number.substr(
          findLastDoc.invoice_payment_number.length - 9
        );
        inv_number = parseFloat(inv_number) + 1;
        inv.invoice_payment_number =
          prefix + String(inv_number).padStart(9, "0");
      }
    });
  };

  const calculateNominal = (nominal, amount_due) => {
    let calcNominal = 0;
    let pay = nominal;

    if (nominal >= amount_due) {
      pay = amount_due;
      calcNominal = nominal - amount_due;
    }
    return {
      pay,
      nominal: calcNominal,
    };
  };

  /*
    exports({
      method:"GET",
      data:null,
      filter:{
        id : "61820edc7ed29d0823ee559d"
      }
    })
  */
  const GET = async () => {
    await getValidation();

    return context.functions.execute("intTransactionInvoiceDetail", {
      id: BSON.ObjectId(payload.filter.id),
      license,
    });
  };

  const getValidation = async () => {
    const { filter } = payload;

    valid.isObjValid(filter, "id", "E20151BE", true);

    await valid.isDataExists(
      collectionNames.transaction,
      {
        _id: BSON.ObjectId(filter.id.toString()),
        license,
      },
      "E30072BE"
    );
  };

  /*
    exports({
      method: "CANCEL_INVOICE",
      data: null,
      filter: {
        id: "61820edd7ed29d0823ee5c5e",
      },
    })
  */
  const CANCEL_INVOICE = async () => {
    await cancelValidation();

    const transaction = await queryTransaction();

    return updateCancelInvoice(transaction[0]);
  };

  const updateCancelInvoice = async (trans) => {
    const { filter, data } = payload;

    const objUpdated = {
      updatedAt: new Date(),
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user_id),
      updatedBy: BSON.ObjectId(user_id),
    };

    trans._id = new BSON.ObjectId();
    trans.status = "refund";
    trans.invoice_status = "";
    trans.refund_reason = data.memo;
    trans.refund_ref = BSON.ObjectId(filter.id);

    trans = {
      ...trans,
      ...objUpdated,
    };

    for (let key in trans) {
      if (trans.hasOwnProperty(key)) {
        if (trans[key] == null) delete trans[key];
      }
    }

    // Define new ID in transaction
    let transaction_detail_id = [];
    let transaction_payment = [];
    let transaction_items = [];

    const payment = trans.payment.map((v) => {
      const payment_id = new BSON.ObjectId();
      v._id = payment_id;
      transaction_payment.push(payment_id);
      return v;
    });

    const transaction_detail = trans.transaction_detail.map((v) => {
      const updatedItem = updateTransactionItem(v.items);
      transaction_items = updatedItem.items;

      v.items = updatedItem.itemId;
      v._id = new BSON.ObjectId();
      transaction_detail_id.push(v._id);
      return v;
    });

    trans.transaction_detail = transaction_detail_id;
    trans.payment = transaction_payment;

    // insert transaction cancel
    await db.collection(collectionNames.transaction).insertOne(trans);
    await db
      .collection(collectionNames.transaction_payment)
      .insertMany(payment);
    await db
      .collection(collectionNames.transaction_detail)
      .insertMany(transaction_detail);
    await db
      .collection(collectionNames.transaction_item)
      .insertMany(transaction_items);

    await db.collection(collectionNames.transaction).updateOne(
      {
        _id: BSON.ObjectId(filter.id),
        license,
      },
      {
        $set: {
          status: "invoice",
          invoice_status: "refund",
        },
      }
    );

    return trans._id;
  };

  const updateTransactionItem = (items) => {
    const itemId = [];
    items = items.map((v) => {
      const item_id = new BSON.ObjectId();
      v._id = item_id;

      for (let key in v) {
        if (v.hasOwnProperty(key)) {
          if (v[key] == null) delete v[key];
        }
      }

      if (!v.discount_type) delete v.discount_type;
      itemId.push(item_id);
      return v;
    });

    return {
      items,
      itemId,
    };
  };

  const queryTransaction = async () => {
    const { filter } = payload;

    return db
      .collection(collectionNames.transaction)
      .aggregate([
        {
          $match: {
            _id: BSON.ObjectId(filter.id),
            license,
          },
        },
        {
          $lookup: {
            from: "transaction_payment",
            localField: "payment",
            foreignField: "_id",
            as: "payment",
          },
        },
        {
          $lookup: {
            from: "transaction_detail",
            let: { transaction_detail: "$transaction_detail" },
            pipeline: [
              {
                $match: { $expr: { $in: ["$_id", "$$transaction_detail"] } },
              },
              {
                $lookup: {
                  from: "transaction_item",
                  let: { items: "$items" },
                  pipeline: [
                    {
                      $match: { $expr: { $in: ["$_id", "$$items"] } },
                    },
                  ],
                  as: "items",
                },
              },
            ],
            as: "transaction_detail",
          },
        },
      ])
      .toArray();
  };

  const cancelValidation = async () => {
    const { filter, data } = payload;

    valid.isObjValid(filter, "id", "E20151BE", true);
    valid.isObjValid(data, "memo", "E20112BE", true);

    const transaction = await db
      .collection(collectionNames.transaction)
      .findOne(
        {
          _id: BSON.ObjectId(filter.id),
          license,
        },
        {
          _id: 1,
          invoice_status: 1,
        }
      );

    if (!transaction) throw new Error("E30072BE");
    if (transaction.invoice_status == "refund") throw new Error("E30008BE");
  };

  /*
    exports({
      method: 'SEND_EMAIL',
      filter: {
        id: '[transaction ID | string]'
      }
    })
  */
  const SEND_EMAIL = async () => {
    const { filter } = payload;
    return db.collection(collectionNames.transaction).updateOne(
      {
        _id: BSON.ObjectId(filter.id),
        license,
      },
      { $set: { sendEmail: false } }
    );
  };

  return Object.freeze({ GET, LIST, POST, CANCEL_INVOICE, SEND_EMAIL });
};
