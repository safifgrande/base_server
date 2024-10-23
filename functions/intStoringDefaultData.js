/*-------------------------
  payload = {
      user_id:'String',
      license:'String',
      outlet_id:"String",
      country_id: "String"
  }
---------------------------*/

exports = async (payload) => {
  try {
    return await storeData(payload);
  } catch (error) {
    context.functions.execute(
      "handleCatchError",
      error,
      "",
      "intStoringDefaultData"
    );

    throw new Error(error.message);
  }
};

const storeData = async (payload) => {
  // prepare to connect to mongodb service
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");
  const payment_types = context.values.get("PAYMENT_TYPES");
  let masterData = {};

  const saveData = async () => {
    const dataToSave = await prepareDataToSave();

    dataToSave.paymentMedias = dataToSave.paymentMedias.map((v) => {
      const type = payment_types.find((obj) => obj.type == v.type);
      v.use_for = type.use_for;
      v.value = parseInt(v.value);
      v.minValue = parseInt(v.minValue);
      v.refundable = type.refundable;
      v.rounding_value = parseFloat(v.rounding_value);
      v.active = v.type != "ewallet";

      return v;
    });
    // membuat default room, product menu, dan product layout
    await insertData(collectionNames.rooms, dataToSave.room);
    await insertData(collectionNames.product_layout, dataToSave.product_layout);
    await insertData(collectionNames.product_menu, dataToSave.product_menu);

    // Note: Decky's modify start here
    // Note: dataToSave contains: Creating Business, Outlet, and ACL
    // Expecting there are two Type Sales, with name "Dine In" and "Take Away"
    dataToSave.typeSales = dataToSave.typeSales.map((eachTypeSales) => {
      eachTypeSales.taxes = dataToSave.taxes.map((eachTax) => {
        return eachTax._id;
      });
      // Note: eachTypeSales.default must be copied from master type sales!!
      eachTypeSales.price_level = dataToSave.priceLevels.filter(
        (v) => v.default === true
      )[0]._id;
      return eachTypeSales;
    });
    // Note: Decky's modify end here

    await insertData(collectionNames.pos_ids, dataToSave.posId);
    await insertData(collectionNames.type_sales, dataToSave.typeSales);
    await insertData(collectionNames.taxes, dataToSave.taxes);
    await insertData(collectionNames.payment_medias, dataToSave.paymentMedias);
    await insertData(collectionNames.price_levels, dataToSave.priceLevels);
    await insertData(collectionNames.refund_reasons, dataToSave.refundReasons);
    await insertData(collectionNames.void_reasons, dataToSave.voidReasons);
    await insertData(collectionNames.general, dataToSave.general);
    await insertData(
      collectionNames.product_departments,
      dataToSave.departments
    );
    await insertData(collectionNames.product_groups, dataToSave.groups);
    await handleSavingBillDesign(dataToSave.bill_design);

    return dataToSave;
  };

  const handleSavingBillDesign = async (bill_design) => {
    const social_media_list = bill_design.social_media.map((data) => {
      return {
        insertOne: {
          document: { ...data },
        },
      };
    });

    await db
      .collection(collectionNames.social_media_bill)
      .bulkWrite(social_media_list);

    bill_design.social_media = bill_design.social_media.map((v) => v._id);
    const bill_id = (await insertData(collectionNames.bill_design, bill_design))
      .insertedId;
    bill_design._id = bill_id;
  };

  const getDataFromDb = async (data) => {
    let list_data = await db
      .collection(data.collection)
      .find(data.filter, data.project)
      .toArray();

    // validasi data != 0
    if (list_data.length == 0) {
      throw new Error(data.error_code);
    }

    if (data.key == "taxes") {
      list_data = list_data.map((v) => {
        return { ...v, taxRate: parseFloat(v.taxRate) };
      });
    }

    masterData = {
      ...masterData,
      [data.key]: list_data,
    };
  };

  const insertData = async (collection, data) => {
    if (data.length !== undefined) {
      return await db.collection(collection).insertMany(data);
    } else {
      return await db.collection(collection).insertOne(data);
    }
  };

  const loadMasterData = async () => {
    const res = {};
    coll.forEach((obj) => (res[obj["key"]] = obj));

    await getDataFromDb(res.posId);
    await getDataFromDb(res.typeSales);
    await getDataFromDb(res.taxes);
    await getDataFromDb(res.paymentMedias);
    await getDataFromDb(res.priceLevels);
    await getDataFromDb(res.refundReasons);
    await getDataFromDb(res.voidReasons);
  };

  const formatBillDesign = async (patternData) => {
    const outlet = await db
      .collection(collectionNames.outlet)
      .aggregate([
        {
          $match: {
            _id: BSON.ObjectId(payload.outlet_id.toString()),
            license: patternData.license,
          },
        },
        {
          $lookup: {
            from: "user_business",
            localField: "business_id",
            foreignField: "_id",
            as: "business",
          },
        },
        {
          $unwind: "$business",
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
          $unwind: "$city",
        },
        {
          $lookup: {
            from: "user",
            let: { license: "$license" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$license", "$$license"] },
                      { $eq: ["$type", "owner"] },
                    ],
                  },
                },
              },
              {
                $project: {
                  _id: 1,
                  phone: 1,
                },
              },
            ],
            as: "user",
          },
        },
        {
          $unwind: "$user",
        },
        {
          $project: {
            _id: 1,
            name: 1,
            address: 1,
            business: { _id: 1, name: 1 },
            city: { _id: 1, name: 1 },
            user: { _id: 1, phone: 1 },
          },
        },
      ])
      .toArray();

    let dataFormatBill;
    if (outlet.length > 0) {
      const { user, city, business } = outlet[0];

      dataFormatBill = {
        _id: new BSON.ObjectId(),
        ...patternData,
        business_id: new BSON.ObjectId(business._id.toString()),
        business_name: business.name,
        outlet: new BSON.ObjectId(outlet[0]._id.toString()),
        outlet_name: outlet[0].name,
        address: outlet[0].address,
        city: new BSON.ObjectId(city._id.toString()),
        city_name: city.name,
        phone_number: user.phone,
        memo: "",
        image_url: "",
        item_price_label: true,
        nota_number: true,
        powered_label: true,
        promo_detail_label: true,
        phone_visibility: true,
        signature: true,
        social_media: [
          {
            _id: new BSON.ObjectId(),
            ...patternData,
            name: "ig",
            value: "",
          },
          {
            _id: new BSON.ObjectId(),
            ...patternData,
            name: "twt",
            value: "",
          },
          {
            _id: new BSON.ObjectId(),
            ...patternData,
            name: "wa",
            value: "",
          },
          {
            _id: new BSON.ObjectId(),
            ...patternData,
            name: "fb",
            value: "",
          },
        ],
      };
    } else {
      dataFormatBill = {
        _id: new BSON.ObjectId(),
        ...patternData,
        business_name: "",
        outlet_name: "",
        address: "",
        city_name: "",
        phone_number: "",
        memo: "",
        image_url: "",
        item_price_label: true,
        nota_number: true,
        powered_label: true,
        promo_detail_label: true,
        phone_visibility: true,
        signature: true,
        social_media: [
          {
            _id: new BSON.ObjectId(),
            ...patternData,
            name: "ig",
            value: "",
          },
          {
            _id: new BSON.ObjectId(),
            ...patternData,
            name: "twt",
            value: "",
          },
          {
            _id: new BSON.ObjectId(),
            ...patternData,
            name: "wa",
            value: "",
          },
          {
            _id: new BSON.ObjectId(),
            ...patternData,
            name: "fb",
            value: "",
          },
        ],
      };
    }

    return dataFormatBill;
  };

  const prepareDataToSave = async () => {
    await loadMasterData();

    let type_currency;
    const { code: country_code } = await db
      .collection(collectionNames.master_reg_country)
      .findOne(
        {
          _id: BSON.ObjectId(payload.country_id.toString()),
        },
        {
          code: 1,
        }
      );

    /*
        Fast Solution untuk currency, karena country yg di cover baru sedikit
    */
    if (country_code === "ID") {
      type_currency = "IDR";
    }

    if (country_code === "SG") {
      type_currency = "SGD";
    }

    if (country_code === "VN") {
      type_currency = "VND";
    }

    if (country_code === "TH") {
      type_currency = "THB";
    }

    // copy from master data
    const patternData = {
      _partition: payload.outlet_id.toString(),
      __v: 0,
      user_id: BSON.ObjectId(payload.user_id.toString()),
      outlet: BSON.ObjectId(payload.outlet_id.toString()),
      license: BSON.ObjectId(payload.license.toString()),
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: BSON.ObjectId(payload.user_id.toString()),
      updatedBy: BSON.ObjectId(payload.user_id.toString()),
    };

    // build data dari master schema
    const dataToReturn = Object.keys(masterData).reduce((prev, next) => {
      prev[next] = masterData[next].map((v) => ({
        ...patternData,
        ...v,
        _id: new BSON.ObjectId(),
      }));
      return prev;
    }, {});

    dataToReturn.bill_design = await formatBillDesign(patternData);

    // create bill image if payload has bill_imge when creating outlet from RF clientOutlets
    if (payload.bill_image) {
      dataToReturn.bill_design.image_url = payload.bill_image;
    }

    //create default room
    dataToReturn.room = {
      _id: new BSON.ObjectId(),
      ...patternData,
      name: "Room 1",
      image_background: "-",
      label: "room 1",
      tables: [],
    };
    delete dataToReturn.room.active;

    //create default product layout
    dataToReturn.product_layout = {
      _id: new BSON.ObjectId(),
      ...patternData,
      items: [],
    };

    //create default product menu
    dataToReturn.product_menu = {
      _id: new BSON.ObjectId(),
      name: "POS Screen",
      product_layouts: [dataToReturn.product_layout._id],
      ...patternData,
      pos_screen: true,
    };

    // create data general
    dataToReturn.general = [
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        name: "consolidate",
        type: "boolean",
        value: "false",
        pos_editable: false,
      },
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        name: "tax_inclusive",
        type: "boolean",
        value: "false",
        pos_editable: false,
      },
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        name: "track_server",
        type: "boolean",
        value: "false",
        pos_editable: false,
      },
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        name: "require_pax",
        type: "boolean",
        value: "false",
        pos_editable: false,
      },
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        name: "automatic_shift",
        type: "boolean",
        value: "false",
        pos_editable: false,
      },
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        name: "currency",
        type: "string",
        value: type_currency,
        pos_editable: false,
      },
    ];

    dataToReturn.groups = [
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        name: "custom",
        hidden: true,
      },
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        name: "package",
        hidden: true,
      },
    ];

    dataToReturn.departments = [
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        product_group: dataToReturn.groups[0]._id,
        name: "custom",
        hidden: true,
        group_active: true,
      },
      {
        ...patternData,
        _id: new BSON.ObjectId(),
        product_group: dataToReturn.groups[1]._id,
        name: "package",
        hidden: true,
        group_active: true,
      },
    ];

    return dataToReturn;
  };

  // Optimize with loop in loadmasterData.
  const coll = [
    {
      key: "posId",
      error_code: "E50001BE",
      collection: collectionNames.master_pos_id,
      filter: { active: true },
      project: { name: 1, _id: 1 },
    },
    {
      key: "typeSales",
      error_code: "E50002BE",
      collection: collectionNames.master_type_sale,
      filter: { active: true },
      project: { name: 1, _id: -1, default: 1 },
    },
    {
      key: "taxes",
      error_code: "E50003BE",
      collection: collectionNames.master_tax,
      filter: { active: true },
      project: { _id: -1, name: 1, taxRate: 1, salesTax: 1, beforeDisc: 1 },
    },
    {
      key: "paymentMedias",
      error_code: "E50004BE",
      collection: collectionNames.master_payment_media,
      filter: {},
      project: {
        _id: -1,
        name: 1,
        type: 1,
        value: 1,
        minValue: 1,
        openDrawer: 1,
        allowSplit: 1,
        signature: 1,
        description: 1,
        rounding_direction: 1,
        rounding_value: 1,
        rounding_flag: 1,
        use_for: 1,
        remark: 1,
        ewallet_type: 1,
        pending_approval: 1,
        active: 1,
        channel_id: 1,
      },
    },
    {
      key: "priceLevels",
      error_code: "E50005BE",
      collection: collectionNames.master_price_level,
      filter: { active: true },
      project: { name: 1, default: -1, _id: 1 },
    },
    {
      key: "refundReasons",
      error_code: "E50006BE",
      collection: collectionNames.master_refund_reason,
      filter: { active: true },
      project: { title: 1, _id: 1 },
    },
    {
      key: "voidReasons",
      error_code: "E50007BE",
      collection: collectionNames.master_void_reason,
      filter: { active: true },
      project: { title: 1, _id: -1 },
    },
  ];

  return await saveData();
};
