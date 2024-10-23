module.exports = async (payload) => {
  try {
    const productStockObject = await productStock(payload);

    const { method } = payload;
    if (productStockObject[method]) {
      return await productStockObject[method]();
    } else {
      return true;
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientProductStock"
    );
  }
};

const productStock = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { license, _id } = context.functions.execute("intUserContext");

  /*
    exports({
      "method":"SEARCH",
      "data":null,
      "filter":{
        sort_by: "name",
        sort_type: 1,
        "business_id":"611e1583f7bf5674c1785823",
        "outlet_id":"",
        "limit":25,
        "page":1,
        "search_text":"",
        "group": "",
        "departments": [""],
      }
    })
  */

  const SEARCH = async () => {
    let { filter } = payload;

    // 1. validation
    SEARCHvalidation();

    // 2. get product list
    await formatingFilter(filter);

    handleScreenFilter();

    // list data aggregasi dari product dan stock
    const stock_summary_list = await listData();

    const recent_audit = await findRecentAudit();

    // return format data list
    return formatReturn(stock_summary_list, recent_audit);
  };

  const SEARCHvalidation = () => {
    // validation
    valid.isRequired(payload, "filter", "E20037BE");

    let { filter } = payload;

    valid.isRequired(filter, "limit", "E20109BE");
    valid.isRequired(filter, "page", "E20109BE");
    valid.isRequired(filter, "business_id", "E20110BE");
  };

  /*
    exports({
      "method":"LIST",
      "data":null,
      "filter":{
        "business_id":"611e1583f7bf5674c1785823",
        "outlet_id":"611e1583f7bf5674c1785822",
        "limit":25,
        "page":1
      }
    })
  */
  const LIST = async () => {
    const { filter } = payload;

    // kemungkina besar ACL ini harus di ganti juga
    await valid.hasPermission("bo_stock_audit");

    await formatingFilter(filter);

    // list data aggregasi dari product dan stock
    const stock_summary_list = await listData();

    const recent_audit = await findRecentAudit();

    // return format data list
    return formatReturn(stock_summary_list, recent_audit);
  };

  const findRecentAudit = async () => {
    const { filter } = payload;

    return db.collection(collectionNames.product_stock_audit).findOne(
      {
        license,
        outlet: filter.outlet,
        date_end: { $exists: false },
      },
      { _id: 1 }
    );
  };

  const formatingFilter = async (filter) => {
    // default filter
    filter.license = BSON.ObjectId(license.toString());
    filter.has_stock = true;

    // find outlet in business
    let outlet_in_bussiness = await context.functions.execute(
      "intOutletsFromBusiness",
      filter.business_id
    );
    delete filter.business_id;

    // jika mempunyai outlet_id ambil satu outlet_id
    // ketika tidak mempunyai filter outlet maka ambil data dari semua oultet by user_id
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

    if (filter.search_text) {
      filter.name = { $regex: filter.search_text, $options: "i" };
      delete filter.search_text;
    } else {
      delete filter.search_text;
    }

    // generate filter department and group
    let filterGroupDepartment = [{ $match: { $and: [] } }];

    if (!filter.group && !filter.departments?.length > 0) {
      filterGroupDepartment = [];
    }

    if (filter.group) {
      filterGroupDepartment[0]["$match"]["$and"].push({
        group_id: BSON.ObjectId(filter.group),
      });
    }

    if (filter.departments?.length > 0) {
      filterGroupDepartment[0]["$match"]["$and"].push({
        "product_department._id": {
          $in: filter.departments.reduce((prev, next) => {
            return [...prev, BSON.ObjectId(next)];
          }, []),
        },
      });
    }

    payload.filterGroupDepartment = filterGroupDepartment;

    delete filter.group;
    delete filter.departments;
  };

  const handleScreenFilter = () => {
    const { filter } = payload;

    let screenFilter;
    if (filter.qty === "available") {
      screenFilter = { $match: { "product_stock.quantity": { $gt: 0 } } };
    } else if (filter.qty === "zero") {
      screenFilter = { $match: { "product_stock.quantity": { $eq: 0 } } };
    } else if (filter.qty === "minus") {
      screenFilter = { $match: { "product_stock.quantity": { $lt: 0 } } };
    }

    filter.qty = screenFilter;
  };

  const listData = async () => {
    const {
      filter: { page, limit, qty, sort_by, sort_type, ...filter },
    } = payload;

    const skip = (page - 1) * limit;

    let sort = { $sort: { lowerName: sort_type ?? 1 } };

    // kalau ada payload sort_by harus ada sort_type , kalau tidak sorting akan default
    if (sort_by && sort_type) {
      if (sort_by !== "name") {
        const obj_sort = {};
        obj_sort[sort_by] = sort_type;
        sort = { $sort: obj_sort };
      }
    }
    delete filter.sort_by;
    delete filter.sort_type;

    let pipeline_query = [
      {
        $match: filter,
      },
      {
        $project: {
          name: 1,
          sku: 1,
          active: 1,
          outlet: 1,
          product_department: 1,
          stocks: 1,
        },
      },
      {
        $lookup: {
          from: "outlet",
          let: { id: "$outlet" },
          pipeline: [
            {
              $match: {
                _id: "$$id",
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
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
        $lookup: {
          from: "product_departments",
          let: { department: "$product_department" },
          pipeline: [
            {
              $match: {
                _id: "$$department",
              },
            },
            {
              $lookup: {
                from: "product_groups",
                let: { group: "$product_group" },
                pipeline: [
                  {
                    $match: { _id: "$$group" },
                  },
                  {
                    $project: {
                      _id: 1,
                    },
                  },
                ],
                as: "product_group",
              },
            },
            {
              $unwind: "$product_group",
            },
            {
              $project: {
                _id: 1,
                name: 1,
                product_group: 1,
              },
            },
          ],
          as: "product_department",
        },
      },
      {
        $unwind: "$product_department",
      },
      {
        $addFields: { group_id: "$product_department.product_group._id" },
      },
      ...payload.filterGroupDepartment,
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
                unit: 1,
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
          sku: 1,
          active: 1,
          product_stock: 1,
          outlet: 1,
          product_department: {
            _id: 1,
            name: 1,
          },
          outlet_id: { $toString: "outlet_id" },
          outlet_name: "$outlet.name",
          department_id: { $toString: "$product_department._id" },
          department_name: "$product_department.name",
          product_stock_id: { $toString: "$product_stock._id" },
          product_stock_quantity: "$product_stock.quantity",
          lowerName: {
            $toLower: "$name",
          },
        },
      },
    ];

    // cek ketika qty berbentu object maka push to query
    // NOTE: harus ada pengecekan di karenakan depens ke dua method LIST SEARCH

    if (typeof qty === "object") {
      pipeline_query.push(qty);
    } else {
      delete filter.qty;
    }

    return db
      .collection(collectionNames.products)
      .aggregate([
        ...pipeline_query,
        {
          $unset: ["product_department", "product_stock", "outlet"],
        },
        sort,
        {
          $group: {
            _id: null,
            totalData: { $sum: 1 },
            data: { $push: "$$ROOT" },
          },
        },
        {
          $project: {
            totalData: 1,
            data: { $slice: ["$data", skip, limit] },
          },
        },
      ])
      .toArray();
  };

  const formatReturn = ([stock_summary_list], recent_audit) => {
    const {
      filter: { limit, page },
    } = payload;

    if (!stock_summary_list) {
      return {
        totalData: 0,
        page: 1,
        totalPage: 0,
        data: [],
      };
    }

    const { totalData, data } = stock_summary_list;

    return {
      audit_id: recent_audit ? recent_audit._id.toString() : "",
      totalData,
      page,
      totalPage: Math.ceil(Number(totalData) / Number(limit)),
      data: data.map((v) => {
        const {
          _id: product_id,
          department_id,
          department_name,
          product_stock_id,
          outlet_id,
          outlet_name,
          product_stock_quantity,
        } = v;

        return {
          id: product_id.toString(),
          name: v.name,
          sku: v.sku,
          active: v.active,
          outlet_id,
          outlet_name,
          department_id,
          department_name,
          product_stock_id,
          product_stock_quantity,
        };
      }),
    };
  };

  /*
    exports({
      method: 'POST',
      data:{
        "description": "init stock",
        "outlet_id": '6144373cc6da72e296dadab9',
        "outlet_dst": '',
        "ref": 'trOUT01',
        "type": 'out',
        "products": [
        {
          "id": "61396da1ff82f4c5e7b6ab17",
          "adjust":20,
          "product_stock_id":"61396da1ff82f4c5e7b6ab18"
        }],
      }
    })
  */
  const POST = async () => {
    // 1. request validation
    await POSTValidation();

    // 2. process and save stock
    return saveToStockHistory();
  };

  const saveToStockHistory = async () => {
    const {
      data: { products, type, outlet_id },
    } = payload;

    const list_id = products.map((v) => BSON.ObjectId(v.id.toString()));

    const list_data_changes = await listDataChanges(list_id);

    // validation stock in data and request
    vaidationStock(list_data_changes);

    // format data before insert to stock history and update product_stock
    let dataFormat = await formatingDataAndUpdateStock(list_data_changes);

    // discuss dengan mas yuda 29 agustus -> audit harusnya tidak save stock_history products yg tidak punya stock
    // logic ini harusnya tidak ada
    // if (type == "audit") {
    // dataFormat = [...dataFormat, ...(await listDataNotChanges(list_id))];
    // }

    const inserted = (
      await db
        .collection(collectionNames.product_stock_history)
        .insertMany(dataFormat)
    ).insertedIds;

    return inserted.map((v) => v.toString());
  };

  // fungsi ini
  const listDataNotChanges = async (list_id) => {
    const { data } = payload;

    const all_product = await db
      .collection(collectionNames.products)
      .aggregate([
        {
          $match: {
            _id: { $nin: list_id },
            license,
            outlet: BSON.ObjectId(data.outlet_id.toString()),
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
        _id: new BSON.ObjectId(),
        product: BSON.ObjectId(prod._id.toString()),
        current: parseFloat(prod.product_stock.quantity),
        quantity: parseFloat(prod.product_stock.quantity),
        description: data.description,
        type: data.type,
        ref: data.ref,
        _partition: data.outlet_id.toString(),
        __v: 0,
        stock_audit: BSON.ObjectId(data.stock_audit.toString()),
        outlet: BSON.ObjectId(data.outlet_id.toString()),
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: BSON.ObjectId(_id.toString()),
        updatedBy: BSON.ObjectId(_id.toString()),
        license,
        user_id: BSON.ObjectId(_id.toString()),
      };
    });
  };

  const listDataChanges = async (list_id) => {
    return db
      .collection(collectionNames.products)
      .aggregate([
        {
          $match: { _id: { $in: list_id }, license }, // need license
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
  };

  const vaidationStock = (list_data_changes) => {
    const {
      data: { products, type },
    } = payload;

    // variable id lower stock than data request
    const id_lt_data = products.reduce((prev, curr) => {
      console.log("list_data_changes", JSON.stringify(list_data_changes));
      console.log("curr", JSON.stringify(curr));

      const obj_data = list_data_changes.find(
        (v) =>
          curr.id === v._id.toString() && curr.adjust > v.product_stock.quantity
      );
      if (obj_data) {
        obj_data.adjust = curr.adjust;
        prev = [...prev, obj_data];
      }

      return prev;
    }, []);

    if (type == "out" && id_lt_data.length > 0) throw new Error("E30081BE");
  };

  const formatingDataAndUpdateStock = async (list_changes) => {
    const {
      data: { products, ...data },
    } = payload;
    const productStockQuery = [];
    // return formating data list

    const result = products.map((prod) => {
      // parse data type
      prod._id = new BSON.ObjectId();
      prod.product = BSON.ObjectId(prod.id.toString());
      delete prod.id;

      const product_change = list_changes.find(
        (v) => v._id.toString() === prod.product.toString()
      );
      prod.current = parseFloat(product_change.product_stock.quantity);

      //value quantity berdasarkan dari type
      let quantity;
      if (data.type === "in") {
        quantity = prod.current + prod.adjust;
      } else if (data.type === "out" || data.type === "trans") {
        quantity = prod.current - prod.adjust;
      } else if (data.type === "audit") {
        // stock audit still work in progress ignore code below
        prod.stock_audit = BSON.ObjectId(data.stock_audit.toString());
        quantity = prod.adjust;
      }

      // parse data
      prod.quantity = parseFloat(quantity);
      delete prod.adjust;

      // update product stock by stock_id dengan memanggil function updateProductStock
      productStockQuery.push(
        updateProductStock(prod.product_stock_id, quantity)
      );

      delete prod.product_stock_id;

      return {
        ...prod,
        description: data.description,
        type: data.type,
        ref: data.ref,
        _partition: data.outlet_id.toString(),
        __v: 0,
        outlet: BSON.ObjectId(data.outlet_id.toString()),
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: BSON.ObjectId(_id.toString()),
        updatedBy: BSON.ObjectId(_id.toString()),
        license,
        user_id: BSON.ObjectId(_id.toString()),
      };
    });

    await db
      .collection(collectionNames.product_stock)
      .bulkWrite(productStockQuery);

    return result;
  };

  const updateProductStock = (stock_id, quantity) => {
    return {
      updateOne: {
        filter: {
          _id: BSON.ObjectId(stock_id),
          license,
        },
        update: {
          $set: {
            quantity: parseFloat(quantity),
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(_id.toString()),
          },
          $inc: { __v: 1 },
        },
      },
    };
  };

  const POSTValidation = async () => {
    const { data } = payload;

    // validate has Permission
    await valid.hasPermission("bo_stock_adjustment");

    // validate Object request
    valid.isObjValid(data, "products", "E20124BE", true);
    valid.isObjValid(data, "ref", "E20126BE", true);
    valid.isObjValid(data, "type", "E20127BE", true);
    await valid.isObjValid(data, "ref", "E20132BE", true);
    await valid.isUnique(
      data,
      collectionNames.product_stock_history,
      "ref",
      "E30071BE"
    );
    const productStockIds = [];
    const outletDstIds = [];
    const outletSrcIds = [];
    // cek products request
    data.products.forEach((prod) => {
      valid.isObjValid(prod, "adjust", "E20119BE", true);
      productStockIds.push(BSON.ObjectId(prod.product_stock_id.toString()));

      // delete outlet_src and outlet_dst if data type
      if (data.type === "trans") {
        valid.isObjValid(prod, "outlet_dst", "E20122BE", true);
        outletDstIds.push(data.outlet_dst);
        outletSrcIds.push(data.outlet_src);
      } else {
        delete prod.outlet_src;
        delete prod.outlet_dst;
      }
    });

    const findStocks = await db
      .collection(collectionNames.product_stock)
      .find({ _id: { $in: productStockIds }, license })
      .toArray();

    if (findStocks.length !== productStockIds.length) {
      throw new Error("E30070BE");
    }
    if (data.type === "trans") {
      const findOutletDst = await db
        .collection(collectionNames.outlet)
        .find({ _id: { $in: outletDstIds }, license })
        .toArray();

      if (findOutletDst.length !== outletDstIds.length) {
        throw new Error("E30042BE");
      }

      const findOutletSrc = await db
        .collection(collectionNames.outlet)
        .find({ _id: { $in: outletSrcIds }, license })
        .toArray();

      if (findOutletSrc.length !== outletSrcIds.length) {
        throw new Error("E30042BE");
      }
    }
  };

  return Object.freeze({ LIST, POST, SEARCH });
};
