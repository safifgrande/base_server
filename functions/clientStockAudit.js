module.exports = async (payload) => {
  try {
    const stockAuditObject = await stockAudit(payload);

    const { method } = payload;
    if (stockAuditObject[method]) {
      return await stockAuditObject[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientStockAudit"
    );
  }
};

const stockAudit = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { license, _id } = context.functions.execute("intUserContext");

  /*
  exports(
    {
    method: "LIST",
    filter: {
      outlet_id: '61de7c781c94aebac3a72c6c',
    },
    data: {},
  }
  )
  */

  const LIST = async () => {
    await listValidation();

    return getProducts();
  };

  const getProducts = async () => {
    const { filter } = payload;

    const products = await db
      .collection(collectionNames.products)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: "product_departments",
            localField: "product_department",
            foreignField: "_id",
            as: "department",
          },
        },
        {
          $unwind: "$department",
        },
        {
          $addFields: {
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
        {
          $group: {
            _id: null,
            products: {
              $push: {
                name: "$name",
                sku: "$sku",
                departmen_name: "$department.name",
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
          },
        },
      ])
      .toArray();

    const outlet = await getOutlet();

    if (products?.length === 0) {
      return {
        detail_outlet: outlet,
        products: [],
      };
    }

    const result = products[0];
    result.detail_outlet = outlet;

    return result;
  };

  const getOutlet = async () => {
    const { filter } = payload;

    const outlet = await db
      .collection(collectionNames.outlet)
      .aggregate([
        {
          $match: {
            _id: filter.outlet,
          },
        },
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
          $project: {
            name: 1,
            address: 1,
            city: "$city.name",
            business: "$business.name",
            image: "$image_url",
            phone_number: "$phone_number",
          },
        },
      ])
      .toArray();

    if (outlet?.length === 0) {
      return null;
    }

    return outlet[0];
  };

  const listValidation = async () => {
    const { filter } = payload;

    await valid.hasPermission("bo_stock_audit");
    if (!filter.outlet_id) throw new Error("E30032BE");

    filter.outlet = BSON.ObjectId(filter.outlet_id);
    filter.has_stock = true;
    filter.license = license;
    filter.active = true;

    delete filter.outlet_id;
  };

  // method ini di pakai untuk cek nama reference yang sama di product_stock_history
  /*
    exports({
    method: 'CHECK',
    data: {
      ref:'gtx1050',
      outlet:'610259f59d6c18c9dc88d459',
    },
    filter: {}
  })
  */
  const CHECK = async () => {
    const { data } = payload;

    await valid.isObjValid(data, "ref", "E20132BE", true);
    await valid.isUnique(
      data,
      collectionNames.product_stock_history,
      "ref",
      "E30071BE"
    );

    return true;
  };

  /*
    exports({
      method: 'POST',
      data:{
        id:'',
        outlet_id:'',
        ref:'AUDIT0001', // dari SERVER
        products: [
          {
            id:'611e15acd024b14075d60385',
            stock_actual:50,
            product_stock_id: "611e15acd024b14075d60386"
          }
        ]
      }
    })
  */

  const POST = async () => {
    // ini stock_audit_id
    const stock_audit_id = payload.data.id
      ? BSON.ObjectId(payload.data.id)
      : BSON.ObjectId();

    // validation request
    await POSTValidation();

    if (payload.data.id) {
      await checkShiftSales();
      await updateStockHistory(stock_audit_id);
    } else {
      // create stock history
      payload.data.ref = payload.data.ref
        ? payload.data.ref
        : "AUDIT-" + Math.floor(new Date().getTime() / 1000).toString();
      await createStockHistory(stock_audit_id);
    }

    return saveStockAudit(stock_audit_id);
  };

  const checkShiftSales = async () => {
    const {
      data: { outlet_id },
    } = payload;

    // ada bug shift di POS,
    // ada data shift yang statusnya close tapi end_date = null
    // belum tau penyebabnya
    // discuss -> apakah perlu di perbaiki datanya -> atau di cari tahu penyebabnya
    // solusi cepat sisi query -> cari shift day terakhir,
    // * kemudian pastikan shift day terkhir end_date naya tidak null (sudah EOD)
    // * jika end_date: null, keluarkan error shift masih berjalan
    const recent_shift = await db
      .collection(collectionNames.shift_sales)
      .aggregate([
        {
          $match: {
            type: "day",
            outlet: BSON.ObjectId(outlet_id.toString()),
            license,
            // end_date: null,
          },
        },
        {
          $sort: {
            _id: -1,
          },
        },
        {
          $limit: 1,
        },
        {
          $project: {
            end_date: 1,
          },
        },
        {
          $match: {
            end_date: null,
          },
        },
      ])
      .toArray();

    if (recent_shift.length > 0) throw new Error("E30076BE");
  };

  const saveStockAudit = async (stock_audit_id) => {
    const { data } = payload;

    let data_upsert;
    if (!data.id) {
      const recent_audit = await findRecentAudit();

      if (recent_audit) {
        return recent_audit._id.toString();
      }

      data_upsert = {
        _id: stock_audit_id,
        __v: 0,
        _partition: data.outlet_id.toString(),
        date_start: new Date(),
        outlet: BSON.ObjectId(data.outlet_id.toString()),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: BSON.ObjectId(_id.toString()),
        updatedBy: BSON.ObjectId(_id.toString()),
        license,
        user_id: BSON.ObjectId(_id.toString()),
      };

      return (
        await db
          .collection(collectionNames.product_stock_audit)
          .insertOne(data_upsert)
      ).insertedId.toString();
    } else {
      data_upsert = {
        date_end: new Date(),
        updatedBy: BSON.ObjectId(_id.toString()),
        license,
      };

      if (data.products.length > 0) {
        const prod_stock_update = data.products.reduce((prev, curr) => {
          return (prev = [
            ...prev,
            {
              updateOne: {
                filter: {
                  _id: BSON.ObjectId(curr.product_stock_id),
                },
                update: {
                  $set: {
                    quantity: parseFloat(curr.stock_actual),
                  },
                },
              },
            },
          ]);
        }, []);

        await db
          .collection(collectionNames.product_stock)
          .bulkWrite(prod_stock_update);
      }

      await db.collection(collectionNames.product_stock_audit).updateOne(
        {
          _id: BSON.ObjectId(data.id),
          license,
        },
        {
          $set: data_upsert,
          $inc: { __v: 1 },
        }
      );

      return data.id;
    }
  };

  const findRecentAudit = async () => {
    const { data } = payload;

    const today = new Date().setHours(0, 0, 0, 0);
    const end_day = new Date().setHours(23, 59, 59, 999);
    const AUDIT_TIME = context.environment.values.AUDIT_TIME_LIMIT;

    const second_arg =
      AUDIT_TIME !== 0
        ? [
            {
              $and: [
                { date_end: { $gte: new Date(today) } },
                { date_end: { $lte: new Date(end_day) } },
              ],
            },
          ]
        : [];

    const recent_audit = await db
      .collection(collectionNames.product_stock_audit)
      .find(
        {
          license,
          outlet: BSON.ObjectId(data.outlet_id.toString()),
          $or: [
            {
              $and: [
                { date_start: { $lte: new Date(end_day) } },
                { date_end: { $exists: false } },
              ],
            },
            ...second_arg,
          ],
        },
        { date_end: 1 }
      )
      .toArray();

    if (recent_audit.length > 0) {
      if (recent_audit[0].date_end) {
        throw new Error("E30074BE");
      }
      return recent_audit[0];
    }

    return null;
  };

  const createStockHistory = async (stock_audit_id) => {
    const { data } = payload;

    // formating products
    const products = await dbListProductStock();

    // formating body for request to RF clientProductStock
    const body = {
      description: "Audit " + new Date().toString(),
      outlet_id: data.outlet_id.toString(),
      outlet_dst: "",
      stock_audit: BSON.ObjectId(stock_audit_id.toString()),
      ref: data.ref,
      type: "audit",
      products,
    };

    // send req.body to RF clientProductStock
    const ress = await context.functions.execute("clientProductStock", {
      method: "POST",
      data: body,
    });
  };

  const updateStockHistory = async (stock_audit_id) => {
    const { data } = payload;

    const stockDatas = await dbRecapStockAudit(stock_audit_id);
    // formating products
    const products = data.products.map((v) => {
      const adjustStock = stockDatas.find(
        (e) => e._id.toString() == v.id.toString()
      );
      return {
        id: v.id.toString(),
        // validasi ini ndak perlu , sudah ada validasi stock actual di POSTValidation
        // quantity:
        //   adjustStock?.stock_actual && adjustStock?.stock_actual > 0
        //     ? parseFloat(adjustStock.stock_actual)
        //     : v.begin_stock,
        ...adjustStock,
        quantity: parseFloat(v.stock_actual),
      };
    });

    const updateData = products.map((obj) => {
      const {
        id: product,
        quantity,
        in_adjust,
        in_refund,
        in_total,
        out_adjust,
        out_sold,
        out_total,
        system_closing,
      } = obj;
      return {
        updateOne: {
          filter: {
            product: BSON.ObjectId(product),
            stock_audit: stock_audit_id,
          },
          update: {
            $set: {
              quantity,
              in_adjust,
              in_refund,
              in_total,
              out_adjust,
              out_sold,
              out_total,
              system_closing,
            },
          },
        },
      };
    });

    // if no data product from payload
    if (updateData.length === 0) {
      return [];
    }

    return db
      .collection(collectionNames.product_stock_history)
      .bulkWrite(updateData);
  };

  const dbListProductStock = async () => {
    const { data } = payload;

    const all_product = await db
      .collection(collectionNames.products)
      .aggregate([
        {
          $match: {
            license,
            outlet: BSON.ObjectId(data.outlet_id),
            has_stock: true,
          },
        },
        {
          $lookup: {
            from: "product_stock",
            let: { stocks: "$stocks" },
            pipeline: [
              {
                $match: { $expr: { $in: ["$_id", "$$stocks"] } },
              },
              {
                $project: {
                  _id: 1,
                  quantity: 1,
                },
              },
            ],
            as: "product_stock",
          },
        },
        {
          $unwind: "$product_stock",
        },
        {
          $project: {
            _id: 1,
            name: 1,
            product_stock: {
              _id: 1,
              quantity: 1,
            },
          },
        },
      ])
      .toArray();

    return all_product.map((prod) => {
      return {
        id: prod._id.toString(),
        adjust: parseFloat(prod.product_stock.quantity),
        begin_stock: parseFloat(prod.product_stock.quantity),
        in_adjust: parseFloat(0),
        in_refund: parseFloat(0),
        in_total: parseFloat(0),
        out_adjust: parseFloat(0),
        out_sold: parseFloat(0),
        out_total: parseFloat(0),
        system_closing: parseFloat(0),
        product_stock_id: prod.product_stock._id.toString(),
      };
    });
  };

  const dbRecapStockAudit = async (stock_audit_id) => {
    const product_stock = await db
      .collection("product_stock_history")
      .aggregate([
        {
          $match: {
            stock_audit: stock_audit_id,
          },
        },
        {
          $lookup: {
            from: "products",
            let: { product_id: "$product" },
            pipeline: [
              {
                $match: { $expr: { $eq: ["$_id", "$$product_id"] } },
              },
              {
                $project: { name: 1 },
              },
            ],
            as: "products",
          },
        },
        {
          $unwind: {
            path: "$products",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "product_stock_history",
            let: {
              product_id: "$product",
              dateStartAudit: "$createdAt",
              dateEndAudit: "$updatedAt",
            },
            pipeline: [
              {
                $match: matchProductStockHistory([{ $eq: ["$type", "in"] }]),
              },
              {
                $group: {
                  _id: "$products",
                  quantity: { $sum: "$quantity" },
                  current: { $sum: "$current" },
                },
              },
              {
                $project: {
                  quantity: { $subtract: ["$quantity", "$current"] },
                },
              },
            ],
            as: "adjust_in",
          },
        },
        {
          $unwind: {
            path: "$adjust_in",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "product_stock_history",
            let: {
              product_id: "$product",
              dateStartAudit: "$createdAt",
              dateEndAudit: "$updatedAt",
            },
            pipeline: [
              {
                $match: matchProductStockHistory([{ $eq: ["$type", "out"] }]),
              },
              {
                $group: {
                  _id: "$products",
                  quantity: { $sum: "$quantity" },
                  current: { $sum: "$current" },
                },
              },
              {
                $project: {
                  quantity: { $subtract: ["$current", "$quantity"] },
                },
              },
            ],
            as: "adjust_out",
          },
        },
        {
          $unwind: {
            path: "$adjust_out",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "transaction_item",
            let: {
              product_id: "$product",
              dateStartAudit: "$createdAt",
              dateEndAudit: "$updatedAt",
            },
            pipeline: [
              {
                $match: matchTransItem([
                  {
                    $eq: ["$refund_ref_index", null],
                  },
                ]),
              },
              {
                $group: {
                  _id: "$item_id",
                  quantity: { $sum: "$qty" },
                },
              },
              {
                $project: { quantity: 1 },
              },
            ],
            as: "transaction_item",
          },
        },
        {
          $unwind: {
            path: "$transaction_item",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "transaction_item",
            let: {
              product_id: "$product",
              dateStartAudit: "$createdAt",
              dateEndAudit: "$updatedAt",
            },
            pipeline: [
              {
                $match: matchTransItem([
                  {
                    $ne: ["$refund_ref_index", null],
                  },
                ]),
              },
              {
                $group: {
                  _id: "$item_id",
                  quantity: { $sum: "$qty" },
                },
              },
              {
                $project: { quantity: 1 },
              },
            ],
            as: "transaction_item_refund",
          },
        },
        {
          $unwind: {
            path: "$transaction_item_refund",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            total_in: {
              $add: [
                { $ifNull: ["$adjust_in.quantity", 0] },
                { $ifNull: ["$transaction_item_refund.quantity", 0] },
              ],
            },
            total_out: {
              $add: [
                { $ifNull: ["$adjust_out.quantity", 0] },
                { $ifNull: ["$transaction_item.quantity", 0] },
              ],
            },
          },
        },
        {
          $addFields: {
            system_closing: {
              $subtract: [
                {
                  $add: [
                    { $ifNull: ["$begin_stock", 0] },
                    { $ifNull: ["$total_in", 0] },
                  ],
                },
                "$total_out",
              ],
            },
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$product",
            in_adjust: { $first: "$adjust_in.quantity" },
            in_refund: { $first: "$transaction_item_refund.quantity" },
            in_total: { $first: "$total_in" },
            out_adjust: { $first: "$adjust_out.quantity" },
            out_sold: { $first: "$transaction_item.quantity" },
            out_total: { $first: "$total_out" },
            system_closing: { $first: "$system_closing" },
            begin_stock: { $first: "$begin_stock" },
          },
        },
        {
          $project: {
            in_adjust: { $toDouble: { $ifNull: ["$in_adjust", 0] } },
            in_refund: { $toDouble: { $ifNull: ["$in_refund", 0] } },
            in_total: { $toDouble: { $ifNull: ["$in_total", 0] } },
            out_adjust: { $toDouble: { $ifNull: ["$out_adjust", 0] } },
            out_sold: { $toDouble: { $ifNull: ["$out_sold", 0] } },
            out_total: { $toDouble: { $ifNull: ["$out_total", 0] } },
            system_closing: { $toDouble: { $ifNull: ["$system_closing", 0] } },
            begin_stock: { $toDouble: { $ifNull: ["$begin_stock", 0] } },
          },
        },
      ])
      .toArray();

    function matchProductStockHistory(params) {
      return {
        $expr: {
          $and: [
            ...params,
            { $eq: ["$product", "$$product_id"] },
            {
              // start_date dari craetedAt product_stock_recap
              $gte: ["$createdAt", "$$dateStartAudit"],
            },
            //  {
            //    $lte: ["$createdAt", "$$dateEndAudit"],
            //  },
          ],
        },
      };
    }

    function matchTransItem(params) {
      return {
        $expr: {
          $and: [
            ...params,
            {
              $gt: ["$createdAt", "$$dateStartAudit"],
            },
            // { $lte: ["$updatedAt", "$$dateEndAudit"] },
            {
              $eq: ["$item_id", "$$product_id"],
            },
          ],
        },
      };
    }

    return product_stock;
  };

  const POSTValidation = async () => {
    const { data } = payload;

    await valid.hasPermission("bo_stock_audit");

    valid.isObjValid(data, "products", "E20124BE", false);
    valid.isObjValid(data, "outlet_id", "E20033BE", true);

    if (data.id) {
      // data products

      const productsId = data.products.reduce((prev, next) => {
        return [...prev, BSON.ObjectId(next.id.toString())];
      }, []);

      const productsStockId = data.products.reduce((prev, next) => {
        return [...prev, BSON.ObjectId(next.product_stock_id.toString())];
      }, []);

      const findProducts = await db
        .collection(collectionNames.products)
        .count({ _id: { $in: productsId }, has_stock: true, license });

      if (findProducts !== productsId.length) {
        throw new Error("E30042BE");
      }

      const findStocks = await db
        .collection(collectionNames.product_stock)
        .count({ _id: { $in: productsStockId }, license });

      if (findStocks !== productsStockId.length) {
        throw new Error("E30070BE");
      }

      const checkId = await db
        .collection(collectionNames.product_stock_audit)
        .findOne(
          {
            _id: BSON.ObjectId(data.id.toString()),
            license,
          },
          { date_end: 1 }
        );

      if (checkId.date_end) {
        throw new Error("E30075BE");
      }

      // loop product, filter product yang stock_actual == nul
      const nullStockId = data.products.reduce((prev, item) => {
        if (item.stock_actual == null) {
          return [...prev, BSON.ObjectId(item.product_stock_id)];
        }
        return prev;
      }, []);

      if (nullStockId.length > 0) {
        // get stock current
        const stocks = await db
          .collection(collectionNames.product_stock)
          .find({ _id: { $in: nullStockId } }, { quantity: 1, _id: 1 })
          .toArray();
        // set stock_actual jadi stock current
        payload.products = data.products.reduce((prev, item) => {
          const findStock = stocks.find(
            (el) => el._id.toString() === item.product_stock_id.toString()
          );

          if (findStock) {
            item.stock_actual = findStock.quantity;
          }

          return [...prev, item];
        }, []);
      }
    }

    const filter = {
      outlet: BSON.ObjectId(data.outlet_id),
      has_stock: true,
      active: true,
      license,
    };

    const products = await db
      .collection(collectionNames.products)
      .count(filter);

    if (products <= 0) throw new Error("E30097BE");
  };

  return Object.freeze({ POST, CHECK, LIST });
};
