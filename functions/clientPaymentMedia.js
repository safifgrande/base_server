module.exports = async (payload) => {
  try {
    const paymentMediaObject = await paymentMedia(payload);

    if (paymentMediaObject[payload.method])
      return await paymentMediaObject[payload.method]();

    throw new Error("Method not found in request");
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientPaymentMedia"
    );
  }
};

const paymentMedia = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const payment_types = context.values.get("PAYMENT_TYPES");

  const user = context.functions.execute("intUserContext");

  // ================ MAIN method start ========================
  /*
    exports({
      method: 'LIST',
      filter: {
        "business_id": string | require,
        "outlet_id": string | optional
      },
      data: {}
    })
  */
  const LIST = async () => {
    await listValidation();

    const paymentMedias = await dbListPaymentMedias();
    return listReturnFormat(paymentMedias);
  };

  /*
    {
      method: 'POST',
      filter: {},
      data: {
        id: [objectId | optional | payment media ID],
        name : [string | required],
        type: [string | required | list ada di list enum],
        active: [boolean | required],
        outlet: [objectId | required],
        value: [number | optional],
        minValue: [number | optional],
        openDrawer:[boolean | required],
        allowSplit:[boolean | required | lihat list enum],
        signature: [boolean | required | signature space printed on print bill / receipt],
        rounding_direction: [string | optional | list ada di list enum],
        rounding_value: [number | optional],
        rounding_flag:[boolean | required | rounding allowed permission],
        pending_approval:[boolean | optional | ewallet pending approval for POS app],
        remark: [boolean | optional | show remark form on POS app],
        ewallet_type: [string | optional | list ada di list enum],
        channel_id: [string | optional | list ada di list enum],
      }
    }
  */
  const POST = async () => {
    await postValidation();

    if (!payload.data.id) {
      return await dbPOSTInsert();
    }

    return await dbPOSTUpdate();
  };

  /*
    exports({
      method:'ACTIVE',
      filter:{
        id: '615fc415d8aacd8a3cf05c6b',
        outlet_id: '6156606885345c6e13961070',
      },
      data:{
        active: true,
      }
    })

    - validate request
    - update active true or false status
  */
  const ACTIVE = async () => {
    await activeValidate();

    const findMedia = await updateActivePaymentMedia();

    if (!findMedia) {
      throw new Error("E30073BE");
    }

    return findMedia._id.toString();
  };

  const LITE = async () => {
    await listValidation();

    const lite_query = await liteQuery();

    return generalReturnFormat(lite_query);
  };

  /*
    exports({
      method: 'LIST_INVOICE',
      filter: {outlet:'611e1583f7bf5674c1785822'},
      data: {}
    })
  */
  const LIST_INVOICE = async () => {
    if (!(await valid.hasPermission(["bo_utility"]), false)) {
      return [];
    }

    payload.filter.license = BSON.ObjectId(user.license.toString());

    if (payload.filter.outlet) {
      payload.filter.outlet = BSON.ObjectId(payload.filter.outlet.toString());
    }

    const payment_media = await db
      .collection(collectionNames.payment_medias)
      .find(
        {
          ...payload.filter,
          use_for: { $in: ["invoice"] },
        },
        {
          _id: 1,
          name: 1,
          type: 1,
          value: 1,
          minValue: 1,
          allowSplit: 1,
          use_for: 1,
          rounding_direction: 1,
          rounding_value: 1,
          rounding_flag: 1,
          ewallet_type: 1,
        }
      )
      .toArray();

    return generalReturnFormat(payment_media);
  };
  // ================ MAIN method end ==========================

  // ================ Helper function start ====================
  const listValidation = async () => {
    const { filter } = payload;

    await valid.hasPermission(["bo_utility"]);

    filter.license = BSON.ObjectId(user.license.toString());

    let outlet_in_bussiness = await context.functions.execute(
      "intOutletsFromBusiness",
      filter.business_id
    );

    // list validation juga di pakai di method LIST
    if (filter.use_for) {
      filter.use_for = { $in: [filter.use_for] };
    }

    if (filter.use_for === "") {
      delete filter.use_for;
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
    delete filter.business_id;
  };

  const listReturnFormat = async (medias) => {
    let outlet_ewallet_active = []; // variable penampung data ewallet yang active

    const data = medias.map(({ outlet, business, ewallet_type, ...media }) => {
      if (
        outlet.xendit_active &&
        !outlet_ewallet_active.find((e) => e === outlet._id.toString())
      ) {
        outlet_ewallet_active.push(outlet._id.toString());
      }

      const data_to_return = {
        id: media._id.toString(),
        name: media.name,
        active: media.active,
        outlet_id: outlet._id.toString(),
        outlet_name: outlet.name,
        business_id: business._id.toString(),
        business_name: business.name,
        media_type: media.type,
        value: media.value,
        min_value: media.minValue,
        open_drawer: media.openDrawer,
        allow_split: media.allowSplit,
        signature: media.signature,
        remark: media.remark,
        rounding_direction: media.rounding_direction,
        rounding_flag: media.rounding_flag,
        rounding_value: media.rounding_value,
      };

      if (ewallet_type) data_to_return.ewallet_type = ewallet_type;

      return data_to_return;
    });

    const mediaTypes = payment_types.reduce(
      (prev, { use_for, refundable, visible, ...data_return }) => {
        if (data_return.type === "ewallet") {
          data_return.outlets = outlet_ewallet_active;
        }

        if (!visible) return prev;

        return [...prev, data_return];
      },
      []
    );

    return {
      types: mediaTypes,
      data,
    };
  };

  const postValidation = async () => {
    const { data } = payload;

    await valid.hasPermission(["bo_utility"]);

    data.value = data.value || 0;
    data.minValue = data.minValue || 0;
    data.rounding_value = data.rounding_value || 100;
    data.rounding_direction = data.rounding_direction || "auto";
    data.rounding_flag = data.rounding_flag || false;

    // sebelumnya hardcoded, di ganti dengan configurable values PAYMENT_TYPES
    data.value = getPaymentType(data.type).static_value ? data.value : 0;
    if (data.allowSplit && !getPaymentType(data.type).allow_split) {
      throw new Error("E20028BE");
    }
    data.allowSplit = getPaymentType(data.type).allow_split
      ? data.allowSplit
      : false;

    // validasi request
    valid.isObjValid(data, "id", "E20106BE", false);
    valid.isObjValid(data, "name", "E20079BE", true);
    valid.isObjValid(data, "type", "E20080BE", true);
    valid.isObjValid(data, "active", "E20081BE", true);
    valid.isObjValid(data, "outlet_id", "E20033BE", true);
    valid.isObjValid(data, "value", "E20082BE", true);
    valid.isObjValid(data, "minValue", "E20083BE", true);
    valid.isObjValid(data, "allowSplit", "E20085BE", true);
    valid.isObjValid(data, "signature", "E20087BE", true);

    data.outlet = BSON.ObjectId(data.outlet_id.toString());
    delete data.outlet_id;

    // check existing outlet
    await valid.isDataExists(
      collectionNames.outlet,
      {
        _id: data.outlet,
        license: BSON.ObjectId(user.license.toString()),
      },
      "E30032BE"
    );

    // check existing name taxes
    await valid.isUnique(
      data,
      collectionNames.payment_medias,
      "name",
      "E30047BE"
    );

    if (data.type == "ewallet") {
      valid.isObjValid(data, "ewallet_type", "E20215BE", true);
      const ewallet_status = await context.functions.execute("clientEwallet", {
        method: "GET_EWALLET_STATUS",
        data: {
          outlet_id: data.outlet.toString(),
        },
        filter: {},
      });

      if (ewallet_status.status !== "active") {
        throw new Error("E30106BE");
      }
    }
  };
  // ================ Helper function end ======================

  // ================ DB function start ========================
  const dbListPaymentMedias = async () => {
    return db
      .collection(collectionNames.payment_medias)
      .aggregate([
        {
          $match: {
            ...payload.filter,
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
            from: collectionNames.user_business,
            localField: "outlet.business_id",
            foreignField: "_id",
            as: "business",
          },
        },
        {
          $unwind: {
            path: "$business",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            name: 1,
            active: 1,
            outlet: { _id: 1, name: 1, xendit_active: 1 },
            business: {
              _id: 1,
              name: 1,
            },
            type: 1,
            ewallet_type: 1,
            value: 1,
            minValue: 1,
            openDrawer: 1,
            allowSplit: 1,
            signature: 1,
            remark: 1,
            rounding_flag: 1,
            rounding_direction: 1,
            rounding_value: 1,
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();
  };

  const dbPOSTUpdate = async () => {
    const { data } = payload;
    if (data.rounding_value) {
      data.rounding_value = parseFloat(data.rounding_value);
    }

    // sebelumnya menggunakan spread operator
    // diganti karena spread operator ber-potensi issue security
    // custom data bisa di inject dari http request
    //
    // dan juga di hilangkan feature update payment type-nya
    // karena saat update ini dibuat, masih banyak task high priority yang lain
    // dan ada logic beberapa flag yang harus di akomodir
    // misal-nya pending_approval, channel_id, dll
    const dataUpdate = {
      name: data.name,
      value: data.value,
      minValue: data.minValue,
      openDrawer: data.openDrawer,
      allowSplit: data.allowSplit,
      signature: data.signature,
      rounding_direction: data.rounding_direction,
      rounding_value: data.rounding_value,
      rounding_flag: data.rounding_flag,
      remark: data.remark,
      active: data.active,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };
    delete dataUpdate.id;

    await db.collection(collectionNames.payment_medias).updateOne(
      {
        _id: BSON.ObjectId(data.id.toString()),
        license: user.license,
      },
      {
        $set: { ...dataUpdate },
        $inc: { __v: 1 },
      }
    );

    return data.id.toString();
  };

  const dbPOSTInsert = async () => {
    const { data } = payload;
    const dataPaymentMedia = {
      __v: 0,
      _id: new BSON.ObjectId(),
      _partition: data.outlet.toString(),
      name: data.name,
      type: data.type,
      value: data.value,
      minValue: data.minValue,
      openDrawer: false, // yuda - 20230710, force disable open drawer untuk initial release
      allowSplit: data.allowSplit,
      signature: data.signature,
      rounding_direction: data.rounding_direction,
      rounding_value: parseFloat(data.rounding_value),
      rounding_flag: data.rounding_flag,
      use_for: getPaymentType(data.type).use_for,
      refundable: getPaymentType(data.type).refundable,
      remark: data.remark,
      active: data.active,
      user_id: BSON.ObjectId(user._id.toString()),
      license: user.license,
      outlet: data.outlet,
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user._id.toString()),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id.toString()),
    };

    if (data.type === "ewallet") {
      dataPaymentMedia.ewallet_type = data.ewallet_type;
      if (dataPaymentMedia.ewallet_type != "qris_static") {
        dataPaymentMedia.pending_approval = true;
        if (dataPaymentMedia.ewallet_type == "ovo") {
          dataPaymentMedia.channel_id = "ID_OVO";
        }
      }
    }

    const payment_media = await db
      .collection(collectionNames.payment_medias)
      .insertOne(dataPaymentMedia);

    return payment_media.insertedId.toString();
  };
  // ================ DB function end ==========================

  const getPaymentType = (type) => {
    const findType = payment_types.find((media) => {
      return media.type == type;
    });

    if (!findType) throw new Error("E30080BE");

    return findType;
  };

  const activeValidate = async () => {
    const { data, filter } = payload;

    await valid.hasPermission("bo_utility");

    if (filter.outlet_id) {
      filter.outlet = BSON.ObjectId(filter.outlet_id.toString());
    }

    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(filter, "outlet", "E20033BE", true);
    valid.isObjValid(filter, "id", "E20106BE", true);

    filter._id = BSON.ObjectId(filter.id.toString());
    filter.license = BSON.ObjectId(user.license.toString());

    delete filter.outlet_id;
    delete filter.id;
  };

  const updateActivePaymentMedia = async () => {
    const { data, filter } = payload;

    const dataUpdate = {
      active: data.active,
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user._id),
    };

    const check_ewallet = await db
      .collection(collectionNames.payment_medias)
      .aggregate([
        {
          $match: filter,
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
            type: 1,
            outlet: {
              _id: 1,
              xendit_active: 1,
            },
          },
        },
      ])
      .toArray();

    if (
      check_ewallet[0].type === "ewallet" &&
      !check_ewallet[0].outlet.xendit_active
    ) {
      throw new Error("E30108BE");
    }

    return db.collection(collectionNames.payment_medias).findOneAndUpdate(
      {
        ...filter,
      },
      {
        $set: { ...dataUpdate },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1 },
      }
    );
  };

  const generalReturnFormat = (media) => {
    return media.map((v) => {
      v.id = v._id.toString();
      delete v._id;

      return v;
    });
  };

  const liteQuery = async () => {
    const { filter } = payload;

    // hapus code ini jika ewallet di ijinkan
    // untuk pembayaran invoice
    // karena saat code ini dibuat, method LITE hanya untuk invoice
    filter.type = { $ne: "ewallet" };

    return db
      .collection(collectionNames.payment_medias)
      .find(
        {
          ...filter,
        },
        {
          _id: 1,
          name: 1,
        }
      )
      .toArray();
  };

  return Object.freeze({ LIST, POST, ACTIVE, LIST_INVOICE, LITE });
};
