module.exports = async (payload) => {
  try {
    const outletsObject = await outlets(payload);
    if (outletsObject[payload.method]) {
      return await outletsObject[payload.method]();
    } else {
      throw new Error("Method not found in request");
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientOutlets"
    );
  }
};

const outlets = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");
  const { outlet, user_business } = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");
  const { _id: user_id, license } = context.functions.execute("intUserContext");

  /*
    exports({
      method: 'POST',
      data: {
        id: "",
        name: "Royal Plaza",
        business_category_id: "60d54dd5c6fe46d1d17ffb73",
        business_id: '60d54dd5c6fe46d1d17ffb73',
        business_name: 'DIY cake',
        country: '603b9dc279df083604d289cc',
        province: '603b9dd379df083604d297ed',
        city: '603b9dd579df083604d29933',
        address: 'Sapphire residence',
        postalCode: '61252',
        phone_number: '+6285655448804',
        active: true,
        open_time: date,
        close_time: date,
        image_url:''
      }
    });

    1. initiate filter
    2. validation
    3. get old data
    4. insert business if new business
    5. save outlet
  */
  const POST = async () => {
    const { data } = payload;

    // 1. initiate filter
    POSTInitiateFilter();

    // 2. validation
    await validation();

    // 4. if new business, just insert the business first
    if (!data.business_id) {
      await insertBusiness();
    }
    // 5. save outlet
    const outlet_id = await handleOutlet();

    return outlet_id.toString();
  };

  /*
    exports({
      "method":"ACTIVE",
      "data":{active: true},
      "filter":{id: '60c80e11cc4ac4f73746cc73'}
    })
  */
  const ACTIVE = async () => {
    // validate ACL
    await valid.hasPermission(["bo_outlet"]);

    const foundOutlet = await dbACTIVEUpdateStatus();
    if (!foundOutlet) {
      throw new Error("E30032BE");
    }

    return foundOutlet._id.toString();
  };

  // Helper function =======
  const POSTInitiateFilter = () => {
    payload.filter = {
      license,
    };

    if (payload.data.id) {
      payload.filter._id = BSON.ObjectId(payload.data.id);
    }
    delete payload.data.id;
  };

  // 1. check acl
  // 2. check each required payload
  // 3. check duplicated outlet name
  // 4. validate old data
  const validation = async () => {
    // 1. check acl
    await valid.hasPermission(["bo_outlet"]);

    // 2. check each required payload
    valid.isObjValid(payload.data, "business_category_id", "E20066BE", true);
    valid.isObjValid(payload.data, "business_name", "E20065BE", true);
    valid.isObjValid(payload.data, "name", "E20067BE", true);
    valid.isObjValid(payload.data, "country", "E30122BE", true);
    valid.isObjValid(payload.data, "province", "E20069BE", true);
    valid.isObjValid(payload.data, "city", "E20070BE", true);
    valid.isObjValid(payload.data, "address", "E20072BE", true);
    valid.isObjValid(payload.data, "phone_number", "E20073BE", true);

    // phone number validation
    phoneValidation();

    await dbPOSTFindDuplicateBussinesName();

    // 3. search duplicate name outlet
    await dbPOSTFindDuplicate();

    // 4. validate old data
    await dbPOSTValidateOldData();
  };

  const dbPOSTFindDuplicateBussinesName = async () => {
    let filter = { ...payload.filter, name: payload.data.business_name };

    if (payload.data.business_id) {
      filter._id = { $ne: BSON.ObjectId(payload.data.business_id.toString()) };
    }

    const duplicateName = await db.collection(user_business).count(filter);
    if (duplicateName > 0) {
      throw new Error("E30002BE");
    }
  };

  const phoneValidation = () => {
    const { data } = payload;
    const phoneregex = /^(^\+62|62|^08)(\d{3,4}-?){2}\d{3,4}$/g.exec(
      data.phone_number
    );

    if (!phoneregex) {
      throw new Error("E20003BE");
    }
  };

  const handleDeleteImage = async () => {
    const { data, oldData } = payload;
    if (
      oldData.image_url &&
      (data.image_url || data.image_url === "") &&
      oldData.image_url !== data.image_url
    ) {
      await context.functions.execute("intRemoveImage", {
        image_url: oldData.image_url,
      });
    }
  };

  const handleOutlet = async () => {
    const {
      filter: { _id },
      data,
      existing_business_id, // ambil dari validasi, pinjam transport ke payload
    } = payload;

    if (!data.open_time) {
      data.open_time = new Date(new Date().setHours(0, 0, 0, 0));
    } else {
      if (!(data.open_time instanceof Date)) {
        data.open_time = new Date(data.open_time);
      }
    }

    if (!data.close_time) {
      data.close_time = new Date(new Date().setHours(23, 59, 59, 999));
    } else {
      if (!(data.close_time instanceof Date)) {
        data.close_time = new Date(data.close_time);
      }
    }

    if (_id) {
      // remove unused image
      await handleDeleteImage();
      // update outlet
      await dbPOSTUpdateExistingOutlet();
      // jika ganti business, maka akan di keluarkan dari business lama
      // dan di masukkan ke business baru
      if (existing_business_id.toString() != data.business_id.toString()) {
        // remove outlet from business
        await dbPOSTRemoveOutletFromBusiness(_id);

        // add outlet to business
        await dbPOSTAddOutletToBusiness(_id);
      }

      return _id;
    } else {
      const outlet_id = new BSON.ObjectId();

      const default_payload = {
        user_id: BSON.ObjectId(user_id),
        license,
        outlet_id,
        country_id: data.country,
      };

      if (data.image_url) {
        default_payload.bill_image = data.image_url;
      }

      const storedData = await context.functions.execute(
        "intStoringDefaultData",
        default_payload
      );

      // insert outlet
      await dbPOSTSaveNewOutlet(outlet_id, storedData);

      // inject new outlet id to user_business
      await dbPOSTAddOutletToBusiness(outlet_id);

      // db update existing bill_design in outlet
      await dbPOSTUpdateBillDesign(outlet_id, storedData);

      return outlet_id;
    }
  };

  // WARNING: digunakan function getValidation, hati2 saat mau update
  const listValidation = () => {
    const { filter } = payload;

    filter.license = BSON.ObjectId(user.license.toString());

    if (filter.business_id) {
      filter.business_id = BSON.ObjectId(filter.business_id.toString());
    }
  };

  const getValidation = () => {
    const { filter } = payload;
    // pinjam function yang ada biar tidak redudant
    listValidation();

    valid.isObjValid(filter, "id", "E20192BE", true);
    filter._id = BSON.ObjectId(filter.id.toString());
    delete filter.id;
  };
  // =======================

  // Database query helper ========

  // mencari outlet dengan nama sama
  const dbPOSTFindDuplicate = async () => {
    let filter = { ...payload.filter, name: payload.data.name };
    if (payload.filter._id) {
      filter._id = { $ne: payload.filter._id };
    }
    if (payload.data.business_id) {
      filter.business_id = BSON.ObjectId(payload.data.business_id.toString());
    } else {
      filter.business_id = new BSON.ObjectId();
    }

    // NOTE : modify delete filter.license removing code because query duplicate name in 1 license di perbolehkan

    const duplicateName = await db.collection(outlet).count(filter);
    if (duplicateName > 0) {
      throw new Error("E30065BE");
    }
  };

  const businessValidation = async () => {
    const { filter, data } = payload;
    return db
      .collection(user_business)
      .aggregate([
        {
          $match: {
            name: data.business_name,
            license,
            outlet: { $in: [filter._id] },
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
          },
        },
      ])
      .toArray();
  };

  const insertBusiness = async () => {
    const {
      data: { business_name, business_category_id },
      filter,
    } = payload;

    let business = null;
    if (filter._id) {
      business = await businessValidation();
    }

    if (business?.length > 0) {
      payload.data.business_id = business[0]._id;
    } else {
      payload.data.business_id = await context.functions.execute(
        "clientUserBusiness",
        {
          method: "POST",
          data: {
            name: business_name,
            business_category_id: business_category_id.toString(),
          },
        }
      );
    }
  };

  const dbPOSTValidateOldData = async () => {
    const { filter } = payload;
    if (filter._id) {
      const oldData = await db
        .collection(outlet)
        .findOne(filter, { _id: 1, business_id: 1 });
      if (!oldData) throw new Error("E30032BE");

      // pinjem payload untuk digunakan di update data
      payload.existing_business_id = oldData.business_id;
      payload.oldData = oldData;
    }
  };

  const dbPOSTSaveNewOutlet = async (outletId, storedData) => {
    const { data } = payload;

    const insertOutlet = {
      _id: outletId,
      _partition: "", // outlet tidak sync, jadi tidak punya partition
      __v: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: BSON.ObjectId(user_id),
      updatedBy: BSON.ObjectId(user_id),
      license: license,
      user_id: BSON.ObjectId(user_id),

      name: data.name,
      business_id: BSON.ObjectId(data.business_id),
      country: BSON.ObjectId(data.country),
      province: BSON.ObjectId(data.province),
      city: BSON.ObjectId(data.city),
      address: data.address,
      active: data.active,
      phone_number: data.phone_number,
      image_url: data.image_url,
      // FIXME: ini ambil dari return intStorageDefaultData,
      // untuk menghindari bug dari RF itu, lebih baik query lagi di RFini
      pos: [storedData.posId[0]._id],
      open_time: data.open_time,
      close_time: data.close_time,
      report_start_date: new Date(new Date().setHours(1, 0, 0, 0)),
      report_end_date: new Date(new Date().setHours(10, 0, 0, 0)),
    };

    if (data.postalCode) {
      insertOutlet.postalCode = data.postalCode.toString();
    }

    await db.collection(outlet).insertOne(insertOutlet);
  };

  const dbPOSTUpdateExistingOutlet = async () => {
    const { filter, data } = payload;
    const setOutlet = {
      user_id: BSON.ObjectId(user_id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),

      name: data.name,
      business_id: BSON.ObjectId(data.business_id.toString()),
      country: BSON.ObjectId(data.country),
      province: BSON.ObjectId(data.province),
      city: BSON.ObjectId(data.city),
      address: data.address,
      active: data.active,
      phone_number: data.phone_number,
      image_url: data.image_url,
      open_time: new Date(data.open_time),
      close_time: new Date(data.close_time),
    };

    if (data.postalCode) {
      setOutlet.postalCode = data.postalCode.toString();
    }

    await db.collection(outlet).updateOne(filter, {
      $set: setOutlet,
      $inc: { __v: 1 },
    });
  };

  const dbPOSTAddOutletToBusiness = async (outlet_id) => {
    const {
      data: { business_id },
    } = payload;
    return db.collection(user_business).updateOne(
      {
        _id: BSON.ObjectId(business_id),
        license,
      },
      {
        // tidak di update __v karena masih satu process pembuatan outlet
        $push: { outlet: outlet_id },
      }
    );
  };

  const dbPOSTRemoveOutletFromBusiness = async (outlet_id) => {
    const { existing_business_id } = payload; // ambil dari validation old data
    return db.collection(user_business).updateOne(
      {
        _id: existing_business_id,
        license,
      },
      {
        $pull: { outlet: outlet_id },
        $inc: { __v: 1 },
      }
    );
  };

  const dbPOSTUpdateBillDesign = async (outlet_id, storedData) => {
    const { data } = payload;

    //find city name
    const { name: cityName } = await db
      .collection(collectionNames.master_reg_city)
      .findOne({ _id: BSON.ObjectId(data.city) }, { name: 1 });

    await db.collection(collectionNames.bill_design).updateOne(
      {
        // ambil dari RF intStoringDefaultData
        _id: BSON.ObjectId(storedData.bill_design._id.toString()),
        license,
      },
      {
        $set: {
          outlet: outlet_id,
          business_id: BSON.ObjectId(data.business_id),
          business_name: data.business_name,
          outlet_name: data.name,
          city: BSON.ObjectId(data.city),
          city_name: cityName,
          address: data.address,
          phone_number: data.phone_number,
        },
      }
    );
  };

  const dbACTIVEUpdateStatus = async () => {
    const {
      data: { active },
      filter: { id },
    } = payload;

    return db.collection(outlet).findOneAndUpdate(
      {
        _id: BSON.ObjectId(id),
        license,
      },
      {
        $set: {
          active,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user_id),
        },
      },
      {
        projection: { _id: 1 },
      }
    );
  };
  // ==============================

  // WARNING: digunakan GET dan LIST, hati2 saat update function ini
  const dbListOutlets = async () => {
    const { filter } = payload;

    return db
      .collection(collectionNames.outlet)
      .aggregate([
        {
          $match: filter,
        },
        {
          $lookup: {
            from: "user_business",
            let: { business_id: "$business_id" },
            pipeline: [
              { $match: { $expr: { $in: ["$_id", ["$$business_id"]] } } },
              {
                $lookup: {
                  from: "master_business_category",
                  localField: "category",
                  foreignField: "_id",
                  as: "category",
                },
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  category: {
                    _id: 1,
                    name: 1,
                  },
                },
              },
            ],
            as: "business",
          },
        },
        {
          $lookup: {
            from: "master_reg_country",
            localField: "country",
            foreignField: "_id",
            as: "country",
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
        {
          $lookup: {
            from: "master_reg_state",
            localField: "province",
            foreignField: "_id",
            as: "province",
          },
        },
        {
          $lookup: {
            from: collectionNames.type_sales,
            let: { idOutlet: "$_id" },
            pipeline: [
              { $match: { outlet: "$$idOutlet", active: true } },
              {
                $project: {
                  _id: 1,
                  name: 1,
                },
              },
            ],
            as: "typeSales",
          },
        },

        {
          $project: {
            _id: 1,
            name: 1,
            active: 1,
            address: 1,
            postalCode: 1,
            image_url: 1,
            phone_number: 1,
            open_time: 1,
            close_time: 1,
            country_code: 1,
            business: 1,
            country: {
              _id: 1,
              name: 1,
            },
            province: {
              _id: 1,
              name: 1,
            },
            city: {
              _id: 1,
              name: 1,
            },
            typeSales: {
              _id: 1,
              name: 1,
            },
            lowerName: {
              $toLower: "$name",
            },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();
  };

  const listOutletReturnFormat = (outlet_list, method) => {
    const temp = outlet_list.map((eachoutlet) => {
      const objOutlet = {
        id: eachoutlet._id.toString(),
        name: eachoutlet.name,
        active: eachoutlet.active,
        address: eachoutlet.address,
        outlet_logo: eachoutlet.image_url,
        phone_number: eachoutlet.phone_number,
        open_time: eachoutlet.open_time,
        close_time: eachoutlet.close_time,
        business: {
          id: eachoutlet.business[0]._id.toString(),
          name: eachoutlet.business[0].name,
          category_id: eachoutlet.business[0].category[0]._id.toString(),
          category_name: eachoutlet.business[0].category[0].name,
        },
        country: {
          id: eachoutlet.country[0]._id.toString(),
          name: eachoutlet.country[0].name,
        },
        city: {
          id: eachoutlet.city[0]._id.toString(),
          name: eachoutlet.city[0].name,
        },
        province: {
          id: eachoutlet.province[0]._id.toString(),
          name: eachoutlet.province[0].name,
        },
        typeSales: eachoutlet.typeSales.map((typesale) => {
          return { id: typesale._id.toString(), name: typesale.name };
        }),
      };

      if (eachoutlet.postalCode) {
        objOutlet.postal_code = eachoutlet.postalCode;
      }

      return objOutlet;
    });

    return payload.method === "LIST" ? temp : temp[0];
  };

  /*
    exports({
      "method":"LIST",
      "filter":{
        "business_id": "60c80e11cc4ac4f73746cc74"
      }
    })
  */
  const LIST = async () => {
    listValidation();

    const outlet_list = await dbListOutlets();

    return listOutletReturnFormat(outlet_list);
  };

  /*
    exports({
      "method":"GET",
      "filter":{
        "id": "60c80e11cc4ac4f73746cc74",
        "business_id": "60c80e11cc4ac4f73746cc74"
      }
    })
  */
  const GET = async () => {
    getValidation();

    const outlet_list = await dbListOutlets();

    return listOutletReturnFormat(outlet_list);
  };

  return Object.freeze({ POST, LIST, ACTIVE, GET });
};
