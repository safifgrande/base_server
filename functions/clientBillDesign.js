module.exports = async (payload) => {
  try {
    const billObject = await billDesign(payload);
    if (!billObject[payload.method])
      throw new Error("Method not found in request");
    return await billObject[payload.method]();
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientBillDesign"
    );
  }
};

const billDesign = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { license, _id } = context.functions.execute("intUserContext");

  /*
    exports({
     "method":"GET",
     "data":null,
      "filter":{
        "outlet_id":"6191b935e403d4081f3a5afe"
      }
    })
  */

  const GET = async () => {
    // validation request
    valid.isRequired(payload.filter, "outlet_id", "E20033BE", false);

    await valid.hasPermission("bo_utility");

    // response data bill_design by outlet
    const data_respon = await getBillDesign();

    return responseFormat(data_respon);
  };

  const responseFormat = (data_respon) => {
    return data_respon.map((obj) => {
      const retObj = {
        ...obj,
        id: obj._id.toString(),
        image_logo: obj.image_url,
        social_media: obj.social_media.map((sm) => {
          const smObj = {
            ...sm,
            id: sm._id.toString(),
          };
          delete smObj._id;
          return smObj;
        }),
      };
      retObj.outlet_id = retObj.outlet.toString();
      delete retObj.outlet;
      delete retObj._id;
      delete retObj.image_url;
      return retObj;
    })[0];
  };

  const getBillDesign = async () => {
    return db
      .collection(collectionNames.bill_design)
      .aggregate([
        {
          $match: {
            outlet: BSON.ObjectId(payload.filter.outlet_id),
            license,
          },
        },
        {
          $lookup: {
            from: "social_media_bill",
            let: { social_media: "$social_media" },
            pipeline: [
              { $match: { $expr: { $in: ["$_id", "$$social_media"] } } },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  active: 1,
                  value: 1,
                },
              },
            ],
            as: "social_media",
          },
        },
        {
          $project: {
            _id: 1,
            business_name: 1,
            outlet: 1,
            outlet_name: 1,
            city_name: 1,
            address: 1,
            phone_number: 1,
            phone_visibility: 1,
            memo: 1,
            nota_number: 1,
            powered_label: 1,
            signature: 1,
            promo_detail_label: 1,
            item_price_label: 1,
            image_url: 1,
            social_media: {
              _id: 1,
              name: 1,
              active: 1,
              value: 1,
            },
          },
        },
      ])
      .toArray();
  };

  /*
    exports({
      "method":"POST",
      "data":{
        "id":"6191b935e403d4081f3a5b18",
        "business_name":"Toko Bunga (Sukomanunggal)",
        "outlet_name":"Outlet 101",
        "address":"Jl sukomanunggal no 7",
        "city_name":"Kabupaten Kenteng Songo",
        "phone_number": "082120015459",
        "phone_visibility": false,
        "memo":"Jangan lupa datang lagi ya!",
        "image_logo":"",
        "item_price_label": true,
        "nota_number": true,
        "powered_label": true,
        "promo_detail_label": true,
        "social_media":[
          {
            "active": true,
            "name": "fb",
            "id": "6191b935e403d4081f3a5b1a"
          },
          {
            "active": true,
            "name": "ig",
            "id": "6191b935e403d4081f3a5b19"
          },
          {
            "active": true,
            "name": "wa",
            "id": "6191b935e403d4081f3a5b1c"
          },
          {
            "active": true,
            "name": "twt",
            "id": "6191b935e403d4081f3a5b1b"
          }
        ]
      },
      "filter":{
      }
      })
  */

  const POST = async () => {
    // validation request

    await POSTvalidation();

    return saveBillDesign();
  };

  const getOldData = async () => {
    let { data } = payload;

    const oldData = await db
      .collection(collectionNames.bill_design)
      .findOne(
        { _id: BSON.ObjectId(data.id), license },
        { _id: 1, image_url: 1 }
      ); // need license ?

    payload.oldData = oldData;
  };

  const saveBillDesign = async () => {
    let { data, filter } = payload;

    // ketika data tidak mempunya filter.id maka akan di anggap data baru
    if (filter.id) {
      await getOldData();

      await handleDeleteImage();

      delete data.id;

      const update_data = {
        ...data,
        updatedAt: new Date(),
        social_media: await handleSocialMedia(),
      };

      await db.collection(collectionNames.bill_design).updateOne(
        {
          license,
          _id: filter.id,
        },
        {
          $set: {
            ...update_data,
          },
        }
      );

      return filter.id.toString();
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

  const handleSocialMedia = async () => {
    const { social_media } = payload.data;

    let bulk_data;
    let list_id = [
      { name: "ig", idx: 0 },
      { name: "twt", idx: 1 },
      { name: "wa", idx: 2 },
      { name: "fb", idx: 3 },
    ];

    if (payload.filter.id) {
      bulk_data = social_media.map((obj) => {
        list_id.filter((e) => e.name == obj.name)[0]._id = BSON.ObjectId(
          obj.id.toString()
        );

        return {
          updateOne: {
            filter: {
              _id: BSON.ObjectId(obj.id.toString()),
              license,
            },
            update: {
              $set: {
                updatedAt: new Date(),
                updatedBy: BSON.ObjectId(_id.toString()),
                ...obj,
              },
            },
          },
        };
      });
    } else {
      bulk_data = social_media.map((obj) => {
        const new_id = new BSON.ObjectId();
        list_id.filter((e) => e.name == obj.name)[0]._id = new_id;

        return {
          insertOne: {
            _id: new_id,
            ...payload.base_data,
            ...obj,
          },
        };
      });
    }

    await db.collection(collectionNames.social_media_bill).bulkWrite(bulk_data);

    const sortedList = list_id
      .slice()
      .sort((prev, curr) => prev.idx - curr.idx);
    return sortedList.map((e) => e._id);
  };

  const POSTvalidation = async () => {
    await valid.hasPermission("bo_utility");

    if (payload.data.id) {
      payload.filter.id = BSON.ObjectId(payload.data.id);
    }

    // 2. validate request
    putValPurePayload();

    // 3. validate data on database
    await validateData();
  };

  const putValPurePayload = () => {
    valid.isObjValid(payload.data, "id", "E20158BE", true);
    valid.isObjValid(payload.data, "business_name", "E20110BE", false);
    valid.isObjValid(payload.data, "outlet_name", "E20094BE", false);
    valid.isObjValid(payload.data, "address", "E20027BE", false);
    valid.isObjValid(payload.data, "city_name", "E20025BE", false);
    valid.isObjValid(payload.data, "phone_number", "E20008BE", true);
    valid.isObjValid(payload.data, "phone_visibility", "E20157BE", true);
    valid.isObjValid(payload.data, "memo", "E20112BE", false);
    valid.isObjValid(payload.data, "nota_number", "E20113BE", true);
    valid.isObjValid(payload.data, "image_logo", "E20118BE", false);
    valid.isObjValid(payload.data, "powered_label", "E20114BE", true);
    valid.isObjValid(payload.data, "promo_detail_label", "E20115BE", true);
    valid.isObjValid(payload.data, "item_price_label", "E20117BE", true);
    valid.isObjValid(payload.data, "signature", "E20159BE", true);
    valid.isObjValid(payload.data, "social_media", "E20116BE", true);

    payload.data.image_url = payload.data.image_logo;
    delete payload.data.image_logo;
  };

  const validateData = async () => {
    if (payload.data.id) {
      await valid.isDataExists(
        collectionNames.bill_design,
        {
          _id: payload.filter.id,
        },
        "E30090BE"
      );
    }

    //TODO : jadikan recursive
    //triming all string data
    Object.keys(payload.data).forEach((key) => {
      if (typeof payload.data[key] === "string") {
        payload.data[key] = payload.data[key].trim();
      }

      if (typeof payload.data[key] === "object") {
        payload.data[key].forEach((smKey) => {
          if (typeof payload.data[key][smKey] === "string") {
            payload.data[key][smKey] = payload.data[key][smKey].trim();
          }
        });
      }
    });
  };

  return Object.freeze({ POST, GET });
};
