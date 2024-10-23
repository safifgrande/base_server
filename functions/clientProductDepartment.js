exports = async (payload) => {
  try {
    const { method } = payload;

    const departObject = generalFunction(payload);
    if (departObject[method]) {
      return await departObject[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientProductDepartment"
    );
  }
};

const generalFunction = (payload) => {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const {
    product_departments,
    product_groups,
    products,
    product_menu_variant,
  } = context.values.get("COLLECTION_NAMES");

  const { _id, license } = context.functions.execute("intUserContext");

  // RF tools to validate data
  const valid = context.functions.execute("intValidation");

  // melakukan validaasi auth, jika context.functions.execute("intUserContext") tidak ada
  // maka akan muncul error
  valid.isAuthenticated();

  /*
      exports({
        method: 'GET',
        filter: {
          outlet_id: 'optional'
        },
        data: {}
      })
    */
  const GET = async () => {
    if (!payload.filter) {
      payload.filter = {};
    }
    payload.filter.license = BSON.ObjectId(license.toString());
    if (payload.filter.outlet_id) {
      payload.filter.outlet = BSON.ObjectId(
        payload.filter.outlet_id.toString()
      );
    }
    // tambahan yuda 20210317
    // data hidden must not return
    // isi data hidden, antara lain department package dan custom
    payload.filter.hidden = false;

    return (await dbGetDepartment()).map(GETBuidResponse);
  };

  /*
      1. validation
      2. create or get existing group
      3. create new department / update existing department
        3.1. validate if product inside department is part of package or not
        3.2.
        3.3. Update field department_active di schema lain

      {
        method: 'POST',
        data: {
          id: string,
          name: string,
          outlet_id: string,
          active: boolean,
          group: {
            id: string,
            name: string
          }
        }
      }
    */
  const POST = async () => {
    const { data } = payload;
    // 1. validation
    await POSTValidate();

    // 2. create or get existing group
    let groupId;
    if (!data.group.id) {
      groupId = await dbCreateNewGroup();
    } else {
      groupId = BSON.ObjectId(data.group.id);
    }

    if (data.id) {
      // existing
      // 3. update existing department

      // 3.1. fetch existing department
      // 3.1. validate if product inside department is part of package or not
      const existingDept = await dbFetchExistingDept();

      /*
          - update semua product dan package yang bagian dari department ini
            jika active state berubah
          - misal dari active=true menjadi active=false,
            maka semua product, product_menu_variant, dan product_layout_item
            di bawah department itu state department_active=false
          - 3.2. Update field department_active di schema lain
        */
      if (existingDept.active != data.active) {
        if (data.active === false) {
          await POSTValidateProductIsPartOfPackage();
        }

        await dbUpdateProducts();
        await dbUpdateProductMenuVariant();
      }

      // 3.3. handle department update
      await dbUpdateDept(groupId);
      await generateViewProducts({ outlet: BSON.ObjectId(data.outlet_id.toString()) })
      return data.id;
    } else {
      // insert new
      // if group inactive, can't add department to it
      if (data.group.id) {
        await POSTValidateGroup();
      }
      // 3. create new department
      return (await dbSaveNewDepartment(groupId)).insertedId.toString();
    }
  };

  /*
      exports({
        method: 'ACTIVE',
        filter: {
           id: '61639a8e31ee74163bcc5d7c',
          outlet_id: '6156606885345c6e13961070',
        },
        data: {
          active: true
        }
      })

      1. validation
      2. get existing department
      3. update product, and variant
      4. update department
    */
  const ACTIVE = async () => {
    const {
      data: { active },
      filter: { outlet_id },
    } = payload;

    // 1. validation
    await ACTIVEValidation();

    // 2. get existing department
    const existingDept = await dbFetchExistingDept();

    // 3. update product, and variant
    if (existingDept.active !== active) {
      if (active === false) {
        await POSTValidateProductIsPartOfPackage();
      }

      await dbUpdateProducts();
      await dbUpdateProductMenuVariant();
    }

    // 4. update department
    return dbUpdateActive();
  };

  /*
      {
        "method":"LITE",
        "data":null,
        "filter":{
          "business_id":"611e1583f7bf5674c1785823",
          "outlet_id":"611e1583f7bf5674c1785822",
          "active":true,
          "total_product": true,
          "show_package": false,
          "only_department": false,
        }
      }

      1. validation
      2. fetch dept
    */
  const LITE = async () => {
    const { filter } = payload;

    // 1. validation
    await LISTValidation(filter);

    // 2. build filter
    buildLiteFilterAndQuery();

    // 3. fetch dept
    return dbLITEGetDept();
  };

  /*
      exports({
        method: 'LIST',
        filter: {
          outlet: 'outlet_id'
        }
      })
    */
  const LIST = async () => {
    /*
      exports({
        "method":"LIST",
        "data":null,
        "filter":{
          "business_id":"60d586a6c6fe46d1d1855352",
          "outlet_id":""
      })
    */
    const { filter } = payload;

    await LISTValidation(filter);

    const productDepartmentList = await db
      .collection(product_departments)
      .aggregate([
        {
          $match: {
            ...payload.filter,
            license: BSON.ObjectId(license.toString()),
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
            from: "product_groups",
            let: { product_group: "$product_group" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$_id", "$$product_group"] },
                      { $ne: ["$hidden", true] },
                    ],
                  },
                },
              }, // mengambil data yg hanya hidden di group false
              {
                $project: {
                  _id: 1,
                  name: 1,
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
            outlet: { _id: 1, name: 1 },
            prices: 1,
            product_group: { _id: 1, name: 1 },
            active: 1,
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();

    return productDepartmentList.map((dept) => {
      const { _id: department_id, name, outlet, product_group, active } = dept;

      return {
        id: department_id.toString(),
        name,
        active,
        group_id: product_group._id.toString(),
        group_name: product_group.name,
        outlet_id: outlet._id.toString(),
        outlet_name: outlet.name,
      };
    });
  };

  // Function helper =====================
  const GETBuidResponse = (v) => {
    const GETRes = {
      ...v,
      id: v._id.toString(),
      license: v.license.toString(),
      outletId: v.outlet[0]._id.toString(),
      outletName: v.outlet[0].name,
      businessId: v.outlet[0].business_id.toString(),
      groupId: v.group[0]._id.toString(),
      groupName: v.group[0].name,
    };
    delete GETRes._id;
    delete GETRes.group;
    delete GETRes.outlet;

    return GETRes;
  };

  const POSTValidate = async () => {
    const { data } = payload;
    await valid.hasPermission("bo_product");

    if (data.id) {
      // edit data
      if (!data.active) {
        await validationDepartmentAvailability(data.id);
      }
    }

    valid.isObjValid(data, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "name", "E20105BE", true);
    valid.isObjValid(data, "id", "E20106BE");
    valid.isObjValid(data, "active", "E20081BE");
    valid.isObjValid(data.group, "name", "E20107BE");
    valid.isObjValid(data.group, "id", "E20108BE");

    if (data.name && data.name.length > 30) {
      throw new Error("E20014BE");
    }

    await valid.isUnique(data, product_departments, "name", "E30058BE");
    await valid.isUnique(
      {
        outlet: data.outlet_id,
        name: data.group.name,
        id: data.group.id,
      },
      product_groups,
      "name",
      "E30059BE"
    );

    if (data.group.id) {
      await valid.isDataExists(
        product_groups,
        {
          license,
          outlet: BSON.ObjectId(data.outlet_id.toString()),
          _id: BSON.ObjectId(data.group.id.toString()),
        },
        "E30034BE"
      );
    }

    // maping ke filter untuk handle function `dbFetchExistingDept`
    payload.filter = {
      outlet: data.outlet_id,
      id: data.id,
    };
  };

  const POSTValidateProductIsPartOfPackage = async () => {
    const relationDeptPackage = await dbFindoutDeptRelationToPackage();

    if (relationDeptPackage.length > 0) {
      throw new Error("E30056BE");
    }
  };

  const POSTValidateGroup = async () => {
    if (!(await dbIsGroupActive())) {
      throw new Error("E30057BE");
    }
  };

  const ACTIVEValidation = async () => {
    const { data, filter } = payload;

    if (filter.outlet_id) {
      filter.outlet = filter.outlet_id.toString();
    }

    if (!data.active) {
      await validationDepartmentAvailability(payload.filter.id);
    }

    await valid.hasPermission("bo_product");
    valid.isObjValid(filter, "outlet_id", "E20033BE", true);
    valid.isObjValid(filter, "id", "E20106BE", true);
    valid.isObjValid(data, "active", "E20081BE", true);
  };

  const LISTValidation = async (filter) => {
    if (!filter) {
      throw new Error("E20037BE");
    }

    valid.isObjValid(filter, "business_id", "E20110BE", true);

    filter.license = BSON.ObjectId(license.toString());

    let outlet_in_bussiness = await context.functions.execute(
      "intOutletsFromBusiness",
      filter.business_id
    );
    delete filter.business_id;

    if (filter.group_id) {
      filter.product_group = BSON.ObjectId(filter.group_id);
      delete filter.group_id;
    }

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
  };

  // validasi department ada di promo active atau tidak
  const validationDepartmentAvailability = async (departmentid) => {
    const itemInPromo = await context.functions.execute(
      "intProductAvailability",
      departmentid
    );
    if (itemInPromo) throw new Error("E30098BE");
  };

  // ====================================

  // Database action ====================
  const dbSaveNewDepartment = async (product_group) => {
    const {
      data: { name, outlet_id, active },
    } = payload;
    return db.collection(product_departments).insertOne({
      // generate new
      _id: new BSON.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),

      // default
      __v: 0,
      hidden: false,
      group_active: true,

      // from auth
      createdBy: BSON.ObjectId(_id.toString()),
      updatedBy: BSON.ObjectId(_id.toString()),
      license,

      // from request
      _partition: outlet_id.toString(),
      outlet: BSON.ObjectId(outlet_id.toString()),
      product_group,
      name,
      active,
      product_qty: 0,
    });
  };

  const dbCreateNewGroup = async () => {
    const {
      data: {
        outlet_id,
        group: { name },
      },
    } = payload;

    const insertGroup = await db.collection(product_groups).insertOne({
      // generated data
      _id: new BSON.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),

      // default data
      __v: 0,
      active: true,
      hidden: false,

      // from auth
      license,
      createdBy: BSON.ObjectId(_id.toString()),
      updatedBy: BSON.ObjectId(_id.toString()),

      // from request
      _partition: outlet_id.toString(),
      outlet: BSON.ObjectId(outlet_id.toString()),
      name,
    });

    return insertGroup.insertedId;
  };

  const dbGetDepartment = () => {
    const { filter } = payload;
    return db
      .collection(product_departments)
      .aggregate([
        {
          $match: {
            ...filter,
          },
        },
        {
          $lookup: {
            from: "product_groups",
            localField: "product_group",
            foreignField: "_id",
            as: "group",
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
          $project: {
            _id: 1,
            name: 1,
            active: 1,
            group_active: 1,
            outlet: {
              _id: 1,
              name: 1,
              business_id: 1,
            },
            license: 1,
            group: {
              _id: 1,
              name: 1,
              outlet: 1,
              license: 1,
            },
          },
        },
      ])
      .toArray();
  };

  const dbFetchExistingDept = async () => {
    const {
      filter: { outlet, id },
    } = payload;

    return db.collection(product_departments).findOne(
      {
        license,
        outlet: BSON.ObjectId(outlet.toString()),
        _id: BSON.ObjectId(id.toString()),
      },
      {
        active: 1,
        group_active: 1,
      }
    );
  };

  const dbUpdateDept = async (product_group) => {
    const {
      data: { outlet_id, id, name, active },
    } = payload;
    return db.collection(product_departments).updateOne(
      {
        license,
        outlet: BSON.ObjectId(outlet_id.toString()),
        _id: BSON.ObjectId(id.toString()),
      },
      {
        $set: {
          name,
          product_group,
          active,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(_id.toString()),
        },
        $inc: { __v: 1 },
      }
    );
  };

  const dbUpdateProducts = async () => {
    const {
      data: { active },
      filter: { id, outlet },
    } = payload;
    db.collection(products).updateMany(
      {
        license,
        outlet: BSON.ObjectId(outlet.toString()),
        product_department: BSON.ObjectId(id.toString()),
      },
      {
        $set: {
          department_active: active,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(_id.toString()),
        },
        $inc: { __v: 1 },
      }
    );
  };

  const dbUpdateProductMenuVariant = async () => {
    const {
      data: { active },
      filter: { id, outlet },
    } = payload;
    db.collection(product_menu_variant).updateMany(
      {
        license,
        outlet: BSON.ObjectId(outlet.toString()),
        product_department: BSON.ObjectId(id.toString()),
      },
      {
        $set: {
          department_active: active,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(_id.toString()),
        },
        $inc: { __v: 1 },
      }
    );
  };

  const dbFindoutDeptRelationToPackage = () => {
    const {
      filter: { id, outlet },
    } = payload;

    return db
      .collection(product_departments)
      .aggregate([
        {
          $match: {
            license,
            outlet: BSON.ObjectId(outlet.toString()),
            _id: BSON.ObjectId(id.toString()),
          },
        },
        {
          $lookup: {
            from: "products",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$product_department", "$$id"] } } },
              {
                $lookup: {
                  from: "product_package_item",
                  localField: "_id",
                  foreignField: "products",
                  as: "productPackage",
                },
              },
              { $project: { name: 1, productPackage: 1 } },
            ],
            as: "product",
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            product_group: 1,
            active: 1,
            product: {
              productPackage: { _id: 1 },
            },
          },
        },
        {
          $unwind: "$product",
        },
        {
          $unwind: "$product.productPackage",
        },
        {
          $group: {
            _id: "$_id",
            size: { $sum: 1 },
          },
        },
      ])
      .toArray();
  };

  const dbIsGroupActive = async () => {
    const {
      data: {
        outlet_id,
        group: { id },
      },
    } = payload;
    return (
      (await db.collection(product_groups).count({
        license,
        outlet: BSON.ObjectId(outlet_id.toString()),
        _id: BSON.ObjectId(id),
        active: true,
      })) > 0
    );
  };

  const dbUpdateActive = async () => {
    const {
      data: { active },
      filter: { outlet, id },
    } = payload;

    await db.collection(product_departments).updateOne(
      {
        license,
        outlet: BSON.ObjectId(outlet.toString()),
        _id: BSON.ObjectId(id.toString()),
      },
      {
        $set: {
          active: active,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(_id.toString()),
        },
        $inc: { __v: 1 },
      }
    );

    await generateViewProducts({ outlet: BSON.ObjectId(outlet.toString()) })

    return id;
  };

  const dbLITEGetDept = () => {
    const { filter } = payload;

    let departmentQuery = [
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          name: 1,
        },
      },
    ];

    // query with group n
    if (!filter.only_department) {
      departmentQuery = [
        {
          $lookup: {
            from: "product_groups",
            let: { product_group: "$product_group" },
            pipeline: [
              {
                $match: {
                  _id: "$$product_group",
                  $expr: {
                    $or: [{ $ne: ["$hidden", true] }, ...payload.packageFilter],
                  },
                },
              }, // mengambil data yg hanya hidden di group false
              {
                $project: {
                  _id: 1,
                  name: 1,
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
          $lookup: {
            from: "products",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  product_department: "$$id",
                },
              },
              {
                $project: {
                  _id: 1,
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
            products: { $size: "$products" },
          },
        },
        {
          $group: {
            _id: "$_id",
            id: { $first: { $toString: "$_id" } },
            name: { $first: "$name" },
            group_id: { $first: { $toString: "$product_group._id" } },
            group_name: { $first: "$product_group.name" },
            total_product: { $sum: "$products" },
          },
        },
        {
          $project: {
            ...payload.projectQuery,
          },
        },
      ];
    }

    delete filter.only_department;

    return db
      .collection(product_departments)
      .aggregate([
        {
          $match: {
            ...filter,
            license: BSON.ObjectId(license.toString()),
            $expr: {
              $or: [{ $ne: ["$hidden", true] }, ...payload.packageFilter],
            },
          },
        },
        ...departmentQuery,
        {
          $sort: { name: 1 },
        },
      ])
      .toArray();
  };

  const buildLiteFilterAndQuery = () => {
    const { filter } = payload;
    // *filter total_product*
    payload.projectQuery = {
      _id: 0,
      total_product: 0,
    };

    if (filter.total_product) {
      payload.projectQuery = {
        _id: 0,
      };
    }

    // *show pacakge*
    payload.packageFilter = [];
    // tampilkan department package jika tidak total product != true
    // total product = true saat ini di gunakan di select reward/term di promo jadi tidak perlu memunculkan department package
    // alasan lainne biar gak ngubah banyak2 :D, intinya perlu diskusi kalo total_product true & show_package true
    // comment by syifak
    if (filter.show_package && !filter.total_product) {
      payload.packageFilter = [
        {
          $and: [{ hidden: true }, { $eq: ["$name", "package"] }],
        },
      ];
    }

    delete filter.total_product;
    delete filter.show_package;
  };

  const generateViewProducts = async (filter) => {
    const { outlet } = filter
    await context.functions.execute("intGenerateView", { outlet, col_view: "view_products", col_db: "products" })
  }

  return Object.freeze({ GET, POST, ACTIVE, LIST, LITE });
};
