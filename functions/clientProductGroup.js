module.exports = async (payload) => {
  try {
    const productGroupObject = await productGroup(payload);
    if (productGroupObject[payload.method]) {
      return await productGroupObject[payload.method]();
    }
    throw new Error("Method not found in request");
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientProductGroup"
    );
  }
};

const productGroup = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  /*
    - init db and collectionNames
    - get user and user acl
  */
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { _id: user_id, license } = context.functions.execute("intUserContext");
  // ================ MAIN method start ========================
  /*
    exports(
      {
        method: "LITE",
        filter: {
          business_id: "61c2b0e47094bafa2e9bdf04",
          outlet_id: "61c2b0e47094bafa2e9bdf03",
          total_department: true,
          active: null | boolean (jika tidak di kirim ,return semua-nya)
        },
      }
    );

    1. validation
    2. query to DB
  */
  const LITE = async () => {
    // 1. validation
    await LITEValidation();

    // 2. query to DB
    const test = await dbLITEGroups();

    return test;
  };

  /*
    exports({
      method: 'GET',
      filter: {
          id: string | require
      }
    })

    1. validation
    2. query group
    3. construct response
  */
  const GET = async () => {
    // 1. validation
    GETValidation();

    // 2. query group
    const product_group_list = await dbGETQueryGroup();

    // 3. construct response
    return GETFormatReturn(product_group_list);
  };

  /*
    exports({
      "method":"LIST",
      "data":null,
      "filter":{
        "business_id":"60d586a6c6fe46d1d1855352",
        "outlet_id":""
    })
  */
  const LIST = async () => {
    if (!payload.filter) throw new Error("E20037BE");

    // default filter
    payload.filter.license = BSON.ObjectId(license.toString());

    let outlet_in_bussiness = await context.functions.execute(
      "intOutletsFromBusiness",
      payload.filter.business_id
    );
    delete payload.filter.business_id;

    if (payload.filter.outlet_id) {
      const outletId = outlet_in_bussiness.find(
        (v) => v.toString() == payload.filter.outlet_id.toString()
      );

      if (!outletId) throw new Error("E30032BE");

      payload.filter.outlet = BSON.ObjectId(outletId.toString());
    } else {
      payload.filter.outlet = { $in: outlet_in_bussiness };
    }
    delete payload.filter.outlet_id;

    const productGroupList = await db
      .collection(collectionNames.product_groups)
      .aggregate([
        {
          $match: {
            ...payload.filter,
            hidden: false,
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
          $project: {
            _id: 1,
            name: 1,
            outlet: { _id: 1, name: 1 },
            //prices: 1,
            active: 1,
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();

    return productGroupList.map((group) => {
      const { _id: group_id, name, active, outlet } = group;

      return {
        id: group_id.toString(),
        name,
        active,
        outlet_id: outlet._id.toString(),
        outlet_name: outlet.name,
      };
    });
  };

  /*
    exports({
      method: 'ACTIVE',
      filter:{
        outlet_id: '611e1583f7bf5674c1785822',
        id: '61419ad7f16e9b1267612723'
      },
      data: {
        active: true
      }
    })

    1. validate request
    2. update active to collection
  */
  const ACTIVE = async () => {
    const { filter } = payload;

    // 1. validate request
    await activeValidation();

    // 2. get existong group active status and department also product in it
    const [exGrp] = await dbGetExistingProduct();

    // 3. Apakah product-nya bagian dari package
    // jika product dari group ini adalah bagian dari package yang masih aktif
    // maka group tidak bisa di non-active-kan
    activeValidatePartOfPackage(exGrp);

    // 2. update group
    await dbUpdateGroupStatus();

    // 3. update department
    await dbUpdateDepartmentStatus(exGrp);

    // 4. update product
    await dbUpdateProductStatus(exGrp);

    await generateViewProducts({
      outlet: BSON.ObjectId(filter.outlet.toString()),
    });

    return payload.filter._id.toString();
  };

  /*
    exports({
      method: 'POST',
      filter: {},
      data: {
        id: string | optional,
        outlet_id: string | require,
        name: string | require,
        active: boolean | require
      }
    })

    1. validation request
    2. insert or update product group
  */
  const POST = async () => {
    const { data } = payload;

    // 1. validation
    await POSTValidation();

    // 2. insert or update product group
    if (!data.id) {
      return await dbPOSTCreateNew();
    } else {
      return await dbPOSTUpdate();
    }
  };
  // ================ MAIN method end ========================

  // ================ Helper function start ==================
  const activeValidation = async () => {
    const { filter, data } = payload;
    // validate active
    valid.isObjValid(filter, "outlet_id", "E20033BE", true);
    valid.isObjValid(filter, "id", "E20108BE", true);
    valid.isObjValid(data, "active", "E20062BE", true);

    if (!data.active) {
      await validationGroupAvailability(payload.filter.id);
    }

    filter.outlet = BSON.ObjectId(payload.filter.outlet_id);
    filter._id = BSON.ObjectId(payload.filter.id);
    delete filter.id;
    delete filter.outlet_id;
  };

  const activeValidatePartOfPackage = ({ active, package_size }) => {
    const {
      data: { active: reqActive },
    } = payload;

    if (active !== reqActive && !reqActive && package_size > 0) {
      // jika reqActive = false
      throw new Error("E30115BE");
    }
  };

  const GETValidation = () => {
    valid.isObjValid(payload, "filter", "E20037BE", true);
    valid.isObjValid(payload.filter, "id", "E20108BE", true);

    // default filter
    payload.filter.license = license;
    payload.filter._id = BSON.ObjectId(payload.filter.id.toString());
    delete payload.filter.id;
  };

  const GETFormatReturn = (data) => {
    if (data.length === 0) throw new Error("E40003BE");

    const {
      _id: group_id,
      name,
      outlet: { _id: outlet_id, business_id: business_id },
      active,
    } = data[0];

    return {
      id: group_id.toString(),
      name,
      outlet_id: outlet_id.toString(),
      business_id: business_id.toString(),
      active,
    };
  };

  const LITEValidation = async () => {
    valid.isObjValid(payload, "filter", "E20037BE", true);

    const { filter } = payload;
    valid.isObjValid(filter, "business_id", "E20110BE", true);

    // mendapatkan list outlet dari schema business
    const outlet_in_bussiness = await context.functions.execute(
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
  };

  const POSTValidation = async () => {
    // validation request
    valid.isObjValid(payload, "data", "E20038BE", true);
    valid.isObjValid(payload.data, "name", "E20074BE", true);
    valid.isObjValid(payload.data, "active", "E20062BE", true);
    valid.isObjValid(payload.data, "outlet_id", "E20033BE", true);

    // validate ACL
    await valid.hasPermission(["bo_product"]);

    // validate outlet
    await valid.isDataExists(
      collectionNames.outlet,
      {
        _id: BSON.ObjectId(payload.data.outlet_id.toString()),
        license: BSON.ObjectId(license.toString()),
      },
      "E30032BE"
    );

    if (payload.data.name && payload.data.name.length > 30) {
      throw new Error("E20014BE");
    }

    if (!payload.data.id) {
      await valid.isUnique(
        payload.data,
        collectionNames.product_groups,
        "name",
        "E30059BE"
      );
    } else {
      await valid.isDataExists(
        collectionNames.product_groups,
        {
          _id: BSON.ObjectId(payload.data.id.toString()),
          outlet: BSON.ObjectId(payload.data.outlet_id.toString()),
        },
        "E30034BE"
      );

      await valid.isUnique(
        payload.data,
        collectionNames.product_groups,
        "name",
        "E30059BE"
      );

      if (!payload.data.active) {
        await validationGroupAvailability(payload.data.id);
      }

      // validate if data is part of package
      await POSTValidatePartOfPackage();
    }
  };

  // validasi group ada di promo active atau tidak
  const validationGroupAvailability = async (groupid) => {
    const itemInPromo = await context.functions.execute(
      "intProductAvailability",
      groupid
    );

    if (itemInPromo) throw new Error("E30105BE");
  };

  // ================ Helper function end ====================

  // ================ DB function start ====================
  const dbUpdateGroupStatus = async () => {
    const { product_groups } = collectionNames;
    const {
      filter,
      data: { active },
    } = payload;

    await db.collection(product_groups).updateOne(
      {
        ...filter,
        license,
      },
      {
        $set: {
          active,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user_id),
        },
        $inc: { __v: 1 },
      }
    );
  };

  const dbGetExistingProduct = async () => {
    const { product_groups } = collectionNames;
    const { filter } = payload;

    return db
      .collection(product_groups)
      .aggregate([
        {
          $match: {
            ...filter,
            license,
          },
        },
        {
          $lookup: {
            from: "product_departments",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$product_group", "$$id"] } } },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  active: 1,
                  group_active: 1,
                  __v: 1,
                },
              },
            ],
            as: "depts",
          },
        },
        { $project: { _id: 1, name: 1, depts: 1, active: 1 } },
        { $addFields: { departments: "$depts._id" } },
        {
          $lookup: {
            as: "prod",
            from: "products",
            let: { dept_ids: "$departments" },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$product_department", "$$dept_ids"] },
                },
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  active: 1,
                  group_active: 1,
                  department_active: 1,
                  __v: 1,
                },
              },
            ],
          },
        },
        { $addFields: { prods: "$prod._id" } },
        {
          $project: {
            _id: 1,
            name: 1,
            departments: 1,
            active: 1,
            prods: 1,
            depts: 1,
            prod: 1,
          },
        },
        {
          $unwind: {
            path: "$prod",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "product_package_item",
            let: { prod: "$prod" },
            pipeline: [
              { $match: { $expr: { $in: ["$$prod._id", "$products"] } } },
              { $project: { _id: 1 } },
            ],
            as: "pckg",
          },
        },
        { $addFields: { packages: "$pckg._id" } },
        {
          $project: {
            _id: 1,
            name: 1,
            departments: 1,
            active: 1,
            prods: 1,
            pkg: { $size: "$packages" },
          },
        },
        {
          $group: {
            _id: "$_id",
            active: { $first: "$active" },
            prods: { $first: "$prods" },
            departments: { $first: "$departments" },
            package_size: { $sum: "$pkg" },
          },
        },
      ])
      .toArray();
  };

  const dbUpdateDepartmentStatus = async ({ departments }) => {
    const { product_departments } = collectionNames;
    const {
      data: { active: group_active },
    } = payload;

    await db.collection(product_departments).updateMany(
      {
        license,
        _id: { $in: departments },
      },
      {
        $set: { group_active },
      }
    );
  };

  const dbUpdateProductStatus = async ({ prods }) => {
    const { products } = collectionNames;
    const {
      data: { active: group_active },
    } = payload;

    await db.collection(products).updateMany(
      {
        license,
        _id: { $in: prods },
      },
      {
        $set: { group_active },
      }
    );
  };

  const dbGETQueryGroup = () => {
    return db
      .collection(collectionNames.product_groups)
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
          $project: {
            _id: 1,
            name: 1,
            outlet: { _id: 1, name: 1, business_id: 1 },
            active: 1,
          },
        },
      ])
      .toArray();
  };

  const dbLITEGroups = async () => {
    const { filter } = payload;

    const projectQuery = filter.total_department
      ? { _id: 0 }
      : { _id: 0, total_department: 0 };
    delete filter.total_department;

    const param = {
      ...filter,
      license,
      name: { $nin: ["custom", "package"] },
    };

    return db
      .collection(collectionNames.product_groups)
      .aggregate([
        { $match: param },
        {
          $lookup: {
            from: "product_departments",
            localField: "_id",
            foreignField: "product_group",
            as: "departments",
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            departments: { $size: "$departments" },
          },
        },
        {
          $group: {
            _id: "$_id",
            id: { $first: { $toString: "$_id" } },
            name: { $first: "$name" },
            total_department: { $sum: "$departments" },
          },
        },
        {
          $project: {
            ...projectQuery,
          },
        },
        {
          $sort: { name: 1 },
        },
      ])
      .toArray();
  };

  const dbPOSTCreateNew = async () => {
    const { data } = payload;
    const insertGroup = await db
      .collection(collectionNames.product_groups)
      .insertOne({
        __v: 0,
        _id: new BSON.ObjectId(),
        _partition: data.outlet_id.toString(),
        active: data.active,
        outlet: BSON.ObjectId(data.outlet_id.toString()),
        license: BSON.ObjectId(license.toString()),
        user_id: BSON.ObjectId(user_id),
        createdAt: new Date(),
        createdBy: BSON.ObjectId(user_id),
        updatedAt: new Date(),
        updatedBy: BSON.ObjectId(user_id),

        name: data.name,
        hidden: false,
      });

    await generateViewProducts({
      outlet: BSON.ObjectId(data.outlet_id.toString()),
    });
    return insertGroup.insertedId.toString();
  };

  const dbPOSTUpdate = async () => {
    const { data } = payload;

    await db.collection(collectionNames.product_groups).updateOne(
      {
        _id: BSON.ObjectId(data.id.toString()), // need license
        license,
      },
      {
        $set: {
          name: data.name,
          active: data.active,
          outlet: BSON.ObjectId(data.outlet_id.toString()),
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user_id),
        },
        $inc: { __v: 1 },
      }
    );

    await generateViewProducts({
      outlet: BSON.ObjectId(data.outlet_id.toString()),
    });
    return data.id.toString();
  };

  const POSTValidatePartOfPackage = async () => {
    payload.filter = {
      outlet: BSON.ObjectId(payload.data.outlet_id),
      _id: BSON.ObjectId(payload.data.id),
    };
    const [exGrp] = await dbGetExistingProduct();

    // Apakah product-nya bagian dari package
    // jika product dari group ini adalah bagian dari package yang masih aktif
    // maka group tidak bisa di non-active-kan
    activeValidatePartOfPackage(exGrp);
  };

  const generateViewProducts = async (filter) => {
    const { outlet } = filter;
    await context.functions.execute("intGenerateView", {
      outlet,
      col_view: "view_products",
      col_db: "products",
    });
  };
  // ================ DB function end ======================

  return Object.freeze({
    GET,
    POST,
    ACTIVE,
    LIST,
    LITE,
  });
};
