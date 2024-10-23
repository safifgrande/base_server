module.exports = async (payload) => {
  try {
    const commissionObject = await commissionFunction(payload);

    const { method } = payload;
    if (commissionObject[method]) {
      return await commissionObject[method]();
    } else {
      return "method is not exists";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientCommission"
    );
  }
};

const commissionFunction = async (payload) => {
  const { data } = payload;

  const valid = context.functions.execute("intValidation", data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { license, _id: user_id } = context.functions.execute("intUserContext");
  const { commission_services, outlet, products, product_package_item } =
    context.values.get("COLLECTION_NAMES");
  let item_collection = products; // item collection bisa bernilai product atau product_package item digunakan di validasi method POST

  /*
    exports ({
      method: "SEARCH",
      filter:{
        type: "products",
        item_id:"",
        page:1,
        limit:25,
        outlet_id:"65a73ec3b52cfe3a0d9ae450",
        search_text:"cuci",
        sort_by:"name",
        sort_type: -1,
        has_commission: true
      }
    })
  */

  const SEARCH = async () => {
    await searchValidation();

    const aggregate_by_type = formatAggregate();

    const list = await listProduct(aggregate_by_type);

    return formatList(list);
  };

  const formatList = ([list]) => {
    const {
      filter: { page, limit },
    } = payload;

    if (!list) {
      return {
        totalData: 0,
        page: 1,
        totalPage: 0,
        data: [],
      };
    }

    const data = list.data.reduce((prev, curr) => {
      curr.id = curr._id.toString();

      if (!curr.items) {
        if (curr.commission_service) {
          curr.commission_type = curr.commission_service.type;
          curr.commission_value = curr.commission_service.value;
          delete curr.commission_service;
        } else {
          curr.commission_type = "-";
          curr.commission_value = 0;
        }
      }

      if (curr.items) {
        curr.items = curr.items.map((pkg_item) => {
          pkg_item.section_id = pkg_item._id.toString();

          const { commission_services } = pkg_item;

          pkg_item.products = pkg_item.products.map((prod_item) => {
            prod_item.product_id = prod_item._id.toString();

            const find_commission = commission_services.find(
              (el) => el.product_id.toString() === prod_item.product_id
            );
            if (find_commission) {
              prod_item.commission_service_id = find_commission._id.toString();
              prod_item.commission_type = find_commission.type;
              prod_item.commission_value = find_commission.value;
            } else {
              prod_item.commission_service_id = "";
              prod_item.commission_type = "-";
              prod_item.commission_value = 0;
            }

            delete prod_item._id;
            return prod_item;
          });

          delete pkg_item.commission_services;
          delete pkg_item._id;

          if (curr.type == "full") {
            pkg_item = {
              ...pkg_item,
              ...pkg_item.products[0],
            };

            delete pkg_item.products;
          }

          return pkg_item;
        });
      }

      delete curr._id;
      return (prev = [...prev, curr]);
    }, []);

    const totalData = list.totalData[0]?.count || 0;

    return {
      data: data,
      totalData,
      page,
      totalPage: Math.ceil(Number(totalData) / Number(limit)),
    };
  };

  const listProduct = async (query) => {
    const {
      filter: { page, limit, sort_type, sort_by, has_commission },
    } = payload;

    let sort = { $sort: { name: sort_type ?? 1 } };

    let data_has_commission = [];
    if (typeof has_commission == "boolean") {
      data_has_commission.push({
        $match: { has_commission_service: has_commission },
      });
    }

    if (sort_by && sort_type) {
      if (sort_by !== "name") {
        const obj_sort = {};
        obj_sort[sort_by] = sort_type;
        sort = { $sort: obj_sort };
      }
    }

    return db
      .collection(query.coll)
      .aggregate([
        {
          $facet: {
            data: [
              ...query.agg,
              sort,
              ...data_has_commission,
              { $skip: page > 0 ? (page - 1) * limit : 0 },
              { $limit: limit },
            ],
            totalData: [
              ...query.agg,
              ...data_has_commission,
              sort,
              { $count: "count" },
            ],
          },
        },
      ])
      .toArray();
  };

  const formatAggregate = () => {
    const {
      filter: { type: fil_type, item_id, outlet_id, search_text },
    } = payload;

    let filter_search = {};
    if (search_text) {
      filter_search["$or"] = [
        { name: { $regex: search_text, $options: "i" } },
        { sku: { $regex: search_text, $options: "i" } },
      ];
    }

    let query = {
      agg: [
        {
          $match: {
            license,
            active: true,
            outlet: BSON.ObjectId(outlet_id.toString()),
            ...filter_search,
          },
        },
        {
          $lookup: {
            from: "commission_services",
            let: { commission_id: { $ifNull: ["$commission_id", []] } },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ["$_id", "$$commission_id"],
                  },
                },
              },
            ],
            as: "commission_service",
          },
        },
        {
          $unwind: {
            path: "$commission_service",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            commission_service: {
              type: 1,
              value: 1,
            },
            has_commission_service: {
              $cond: {
                if: { $ifNull: ["$commission_service", false] },
                then: true,
                else: false,
              },
            },
          },
        },
      ],
      coll: "products",
    };

    if (fil_type === "package") {
      query = {
        agg: [
          {
            $match: {
              active: true,
              license,
              outlet: BSON.ObjectId(outlet_id.toString()),
              ...filter_search,
            },
          },
          {
            $lookup: {
              from: "product_package_item",
              let: { items: "$items" },
              pipeline: [
                {
                  $match: { $expr: { $in: ["$_id", "$$items"] } },
                },
                {
                  $lookup: {
                    from: "products",
                    let: { products: "$products" },
                    pipeline: [
                      {
                        $match: {
                          $expr: {
                            $in: ["$_id", "$$products"],
                          },
                        },
                      },
                      {
                        $project: {
                          name: 1,
                        },
                      },
                    ],
                    as: "products",
                  },
                },
                {
                  $project: {
                    name: "$label",
                    products: 1,
                    max: 1,
                    min: 1,
                    commission_service_ids:
                      "$commission_service_ids.commission_id",
                    has_commission_service: {
                      $cond: [
                        {
                          $and: [
                            { $ifNull: ["$commission_service_ids", false] },
                            { $size: "$commission_service_ids" },
                          ],
                        },
                        true,
                        false,
                      ],
                    },
                  },
                },
                {
                  $lookup: {
                    from: "commission_services",
                    as: "commission_services",
                    let: {
                      comm_ids: { $ifNull: ["$commission_service_ids", []] },
                    },
                    pipeline: [
                      {
                        $match: {
                          $expr: {
                            $in: ["$_id", "$$comm_ids"],
                          },
                        },
                      },
                      {
                        $project: {
                          type: 1,
                          value: 1,
                          package_id: 1,
                          package_item_id: 1,
                          product_id: 1,
                        },
                      },
                    ],
                  },
                },
                {
                  $unset: "commission_service_ids",
                },
              ],
              as: "items",
            },
          },
          {
            $project: {
              name: 1,
              items: 1,
              has_commission_service: {
                $cond: [
                  {
                    $in: [true, "$items.has_commission_service"],
                  },
                  true,
                  false,
                ],
              },
              type: 1,
            },
          },
        ],
        coll: "product_package",
      };
    }

    if (fil_type === "department" || fil_type === "group") {
      let match = [
        {
          $match: {
            license,
            active: true,
            outlet: BSON.ObjectId(outlet_id.toString()),
          },
        },
      ];

      if (fil_type == "department") {
        match[0]["$match"]._id = BSON.ObjectId(item_id.toString());
      }

      if (fil_type == "group") {
        match[0]["$match"].product_group = BSON.ObjectId(item_id.toString());
      }

      query = {
        agg: [
          ...match,
          {
            $lookup: {
              from: "products",
              let: { id: "$_id", name: "$name" },
              pipeline: [
                {
                  $match: filter_search,
                },
                { $match: { $expr: { $eq: ["$product_department", "$$id"] } } },
                {
                  $lookup: {
                    from: "commission_services",
                    let: { commission_id: { $ifNull: ["$commission_id", []] } },
                    pipeline: [
                      {
                        $match: {
                          $expr: {
                            $eq: ["$_id", "$$commission_id"],
                          },
                        },
                      },
                    ],
                    as: "commission_service",
                  },
                },
                {
                  $unwind: {
                    path: "$commission_service",
                    preserveNullAndEmptyArrays: true,
                  },
                },
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    department_id: { $toString: `$$id` },
                    department_name: `$$name`,
                    commission_service: {
                      type: 1,
                      value: 1,
                    },
                    has_commission_service: {
                      $cond: {
                        if: { $ifNull: ["$commission_service", false] },
                        then: true,
                        else: false,
                      },
                    },
                  },
                },
              ],
              as: "products",
            },
          },
          {
            $project: {
              _id: 1,
              name: 1,
              product_group: 1,
              active: 1,
              products: 1,
            },
          },
          {
            $unwind: "$products",
          },
          {
            $replaceRoot: {
              newRoot: "$products",
            },
          },
        ],
        coll: "product_departments",
      };
    }

    return query;
  };

  const searchValidation = async () => {
    const { filter } = payload;

    await valid.hasPermission(["bo_utility"]);

    valid.isObjValid(filter, "type", "E20192BE", true);
    valid.isRequired(filter, "limit", "E20109BE");
    valid.isRequired(filter, "page", "E20109BE");
    valid.isRequired(filter, "outlet_id", "E20033BE");

    if (filter.type === "department" || filter.type === "group") {
      valid.isObjValid(filter, "item_id", "E20192BE", true);
    }
  };

  /*
  payload type product :

  exports({
    "method":"POST",
    "headers":{"Lang":"id"},
    "data":{
      "outlet_id":"65701dcae884a0e26282b874",
      "type":"percentage",
      "value":100,
      "item_products":["659bb12d4f0de4fc8db5d6bd","65bc52c1372f24d3f5329b7a","65bc51f2372f24d3f53209f8"],
      "package_id":"",
      "filter":{}
  })

  payload type package :

  exports({
    "method":"POST",
    "data":{
      "outlet_id":"65701dcae884a0e26282b874",
      "type":"",
      "value":"",
      "items":[
        {
         "id": "65bc50d011ec900bfebe354f",  // if package_id exists
         "type":"nominal", // updateOne cocommission_service from $or $ne type  || value
         "section_id":"",
         "value":5000
        },
        {
         "id": "65bc50e77af59568b40f9558",  // if package_id exists
         "type":"percentage",
         "section_id":"",
         "value":"20"
        }
      ],
      "item_products":[],
      "package_id":"65c08f064c7c44ec5bfaa015"
    },
    "filter":"",
  })
  */

  const POST = async () => {
    await postValidation();

    const bulk_data =
      data.item_products && data.item_products.length > 0
        ? await formatData()
        : await formatDataPackage();

    return saveCommission(bulk_data);
  };

  const formatDataPackage = async () => {
    const { package_id, section_id, items } = data;

    const bulk_data = section_id.reduce(
      (prev, curr) => {
        const { products, commission_service_ids } = curr;
        let pkg_item_write = [];
        let delete_comm = [];
        products.forEach((id) => {
          const obj = items.find((item) => item.id === id.toString());

          if (!obj) {
            return prev;
          }

          const findExistingComm = commission_service_ids
            ? commission_service_ids.find(
                (e) => e.product_id.toString() === id.toString()
              )
            : null;

          let comm_write = {};
          if (findExistingComm) {
            if (parseFloat(obj.value) === 0 || !obj.value) {
              delete_comm.push(findExistingComm.commission_id);
              return prev;
            } else {
              comm_write = {
                updateOne: {
                  filter: {
                    _id: findExistingComm.commission_id,
                    $or: [
                      { type: { $ne: obj.type } },
                      { value: { $ne: parseFloat(obj.value) } },
                    ],
                  },
                  update: {
                    $set: {
                      type: obj.type,
                      value: parseFloat(obj.value),
                    },
                    $inc: { __v: 1 },
                  },
                },
              };
            }
          } else {
            if (parseFloat(obj.value) === 0 || !obj.value) {
              return prev;
            }

            let id_com = new BSON.ObjectId();

            let data_comm = {
              _id: id_com,
              __v: 0,
              _partition: data.outlet.toString(),
              user_id: BSON.ObjectId(user_id),
              license,
              outlet: BSON.ObjectId(data.outlet.toString()),
              createdAt: new Date(),
              createdBy: BSON.ObjectId(user_id),
              updatedAt: new Date(),
              updatedBy: BSON.ObjectId(user_id),
              type: obj.type,
              package_id: BSON.ObjectId(data.package_id.toString()),
              package_item_id: curr._id,
              product_id: BSON.ObjectId(obj.id),
              value: parseFloat(obj.value),
            };

            comm_write = {
              insertOne: data_comm,
            };

            pkg_item_write.push({
              commission_id: id_com,
              product_id: id,
            });
          }

          prev.comm_write = [...prev.comm_write, comm_write];
        });

        if (pkg_item_write.length > 0) {
          prev.item_write = [
            ...prev.item_write,
            {
              updateOne: {
                filter: {
                  _id: curr._id,
                },
                update: {
                  $push: {
                    commission_service_ids: { $each: pkg_item_write },
                  },
                },
              },
            },
          ];
        }

        if (delete_comm.length > 0) {
          prev.comm_write = [
            ...prev.comm_write,
            {
              deleteMany: {
                filter: { _id: { $in: delete_comm } },
              },
            },
          ];

          prev.item_write = [
            ...prev.item_write,
            {
              updateOne: {
                filter: {
                  _id: curr._id,
                },
                update: {
                  $pull: {
                    commission_service_ids: {
                      commission_id: { $in: delete_comm },
                    },
                  },
                  $inc: { __v: 1 },
                },
              },
            },
          ];
        }

        return prev;
      },
      { comm_write: [], item_write: [] }
    );

    return bulk_data;
  };

  const formatData = async () => {
    let delete_comm = [];
    const bulk_data = data.item_products.reduce(
      (prev, curr) => {
        // create commission_services bulk to insert commission and assign to product

        if (!curr.commission_id) {
          if (parseFloat(data.value) === 0) {
            return prev;
          }

          let id_com = new BSON.ObjectId();

          let data_comm = {
            _id: id_com,
            __v: 0,
            _partition: data.outlet.toString(),
            user_id: BSON.ObjectId(user_id),
            license: license,
            outlet: BSON.ObjectId(data.outlet.toString()),
            createdAt: new Date(),
            createdBy: BSON.ObjectId(user_id),
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user_id),
            type: data.type,
            product_id: curr._id,
            value: parseFloat(data.value),
          };

          prev.comm_write = [...prev.comm_write, { insertOne: data_comm }];
          prev.item_write = [
            ...prev.item_write,
            {
              updateOne: {
                filter: {
                  _id: curr._id,
                },
                update: {
                  $set: { commission_id: id_com },
                  $inc: { __v: 1 },
                },
              },
            },
          ];

          return prev;
        }

        // agar lebih mudah cara trace data komisi yang di update maka process pembentukan bulk write dipisah
        if (curr.commission_id) {
          if (parseFloat(data.value) === 0) {
            delete_comm.push(curr.commission_id);
            return prev;
          }

          const dataUpdate = {
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user_id),

            type: data.type,
            value: parseFloat(data.value),
          };

          prev.comm_write = [
            ...prev.comm_write,
            {
              updateOne: {
                filter: {
                  _id: curr.commission_id,
                  product_id: curr._id,
                },
                update: {
                  $set: dataUpdate,
                  $inc: { __v: 1 },
                },
              },
            },
          ];
          return prev;
        }
      },
      { comm_write: [], item_write: [] }
    ); // comm_write = data commission_services , item_write item bisa product bisa package dll

    if (delete_comm.length > 0) {
      bulk_data.comm_write = [
        ...bulk_data.comm_write,
        {
          deleteMany: {
            filter: {
              _id: { $in: delete_comm },
            },
          },
        },
      ];

      bulk_data.item_write = [
        ...bulk_data.item_write,
        {
          updateMany: {
            filter: {
              commission_id: { $in: delete_comm },
            },
            update: {
              $unset: { commission_id: "" },
            },
          },
        },
      ];
    }

    return bulk_data;
  };

  const postValidation = async () => {
    const { data } = payload;

    await valid.hasPermission(["bo_utility"]); // sementara masuk utility

    valid.isObjValid(data, "outlet_id", "E20192BE", true);

    // check data outlet
    await valid.isDataExists(
      outlet,
      {
        _id: BSON.ObjectId(data.outlet_id.toString()),
        license: license,
      },
      "E30032BE"
    );
    data.outlet = data.outlet_id;
    delete data.outlet_id;

    // check data items exists or not in products or package items
    if (data.package_id) {
      item_collection = product_package_item;
      valid.isObjValid(data, "items", "E20053BE", true);
    } else {
      valid.isObjValid(data, "item_products", "E20053BE", true);
      valid.isObjValid(data, "type", "E20055BE", true);
      valid.isObjValid(data, "value", "E20060BE", true);
    }

    if (data.item_products && data.item_products.length > 0) {
      const data_products = await db
        .collection(item_collection)
        .find(
          {
            _id: { $in: data.item_products.map((id) => BSON.ObjectId(id)) },
          },
          {
            _id: 1,
            commission_id: 1,
          }
        )
        .toArray();

      if (data_products.length !== data.item_products.length)
        throw new Error("E30134BE");
      data.item_products = data_products;
    }

    if (data.items && data.package_id) {
      const section_ids = data.items.reduce((prev, curr) => {
        const findSection = prev.find(
          (id) => id.toString() === curr.section_id
        );

        if (!findSection) {
          prev = [...prev, BSON.ObjectId(curr.section_id)];
        }

        return prev;
      }, []);

      if (data.items.length > 0) {
        const data_products = await db
          .collection(item_collection)
          .aggregate([
            {
              $match: {
                _id: { $in: section_ids },
              },
            },
            {
              $project: {
                _id: 1,
                products: 1,
                label: 1,
                commission_service_ids: 1,
              },
            },
          ])
          .toArray();

        if (data_products.length !== section_ids.length)
          throw new Error("E30134BE");
        data.section_id = data_products;
      }
    }
  };

  const saveCommission = async (bulk_data) => {
    const { comm_write, item_write } = bulk_data;

    if (comm_write.length > 0) {
      await db.collection(commission_services).bulkWrite(comm_write);
    }

    if (item_write.length > 0) {
      await db.collection(item_collection).bulkWrite(item_write);
    }

    return true;
  };

  return Object.freeze({ SEARCH, POST });
};
