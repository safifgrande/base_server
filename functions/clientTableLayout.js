exports = async (payload) => {
  try {
    const destFunction = generalFunction(payload);
    const { method } = payload;
    if (destFunction[method]) {
      return await destFunction[method]();
    } else {
      return true;
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientTableLayout"
    );
  }
};

const generalFunction = (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  /*
    exports({
      method: 'LIST',
      filter: {
        room_id: '6156606885345c6e1396108d',
        outlet_id: '6156606885345c6e13961070',
      }
    })
  */
  const LIST = async () => {
    // 1. validate ACL
    // validate ACL tapi tidak perlu throw error
    if (!(await valid.hasPermission(["bo_table"], false))) {
      return [];
    }

    // 2. initiate filter
    buildListFilter();

    // 3. get tables from db
    const rawData = await dbListTable();

    // 4. build response
    return listReturnFormat(rawData);
  };

  /*
    exports({
      method: 'POST',
      data: {
        id: '',
        outlet_id: '6156606885345c6e13961070',
        label: 'Table A',
        location: {
          x: 0,
          y: 0,
          z: 0
        },
        pax: 5,
        room_id: "6156606885345c6e1396108d"
      }
    })
  */
  const POST = async () => {
    // 1. data validation
    await dataValidator();

    // 2. getOldData (pengecekan selain berdasarkan payload id, juga berdasarkan titik xyz, jika lokasinya sama persis, dan ruangannya sama, data yang sudah ada tersebut diedit)
    const oldData = await getOldData();

    // 3. simpan data
    return handleSaveData(oldData);
  };

  /*
  exports({
    method: 'DELETE',
    filter: {
      id: '6178ba08d36e8deffe8f9170',
      outlet_id: '6156606885345c6e13961070',
    }
  })
  */

  const DELETE = async () => {
    // 1. validate & build filter
    await validationDeleteAndBuildFilter();
    // 2. check table is not in use
    const table = await tableValidation();
    // 3. delete table
    await handleDeleteTable();
    // 4. remove table from room
    await removeTableToRoom(payload, table);

    return table._id.toString();
  };

  const tableValidation = async () => {
    const findtable = await db
      .collection(collectionNames.tables)
      .findOne(payload.filter, { _id: 1, status: 1, room_id: 1 });

    if (!findtable) throw new Error("E30053BE");

    if (!["available", "disable"].includes(findtable.status))
      throw new Error("E30084BE");

    return findtable;
  };

  const validationDeleteAndBuildFilter = async () => {
    const { filter } = payload;

    await valid.hasPermission(["bo_table"]);

    valid.isObjValid(filter, "outlet_id", "E20033BE", true);
    valid.isObjValid(filter, "id", "E20106BE", true);

    filter.license = BSON.ObjectId(user.license.toString());
    filter.outlet = BSON.ObjectId(payload.filter.outlet_id.toString());
    filter._id = BSON.ObjectId(payload.filter.id.toString());

    delete filter.id;
    delete filter.outlet_id;
  };

  const handleDeleteTable = async () => {
    await db.collection(collectionNames.tables).deleteOne(payload.filter);
  };

  const removeTableToRoom = async (
    { filter: { license, outlet } },
    { _id: table_id, room_id }
  ) => {
    // tambahkan table ke schema room pada field `tables`
    await db.collection(collectionNames.rooms).updateOne(
      { _id: room_id, license, outlet },
      {
        $pull: {
          tables: table_id,
        },
      }
    );
  };

  const buildListFilter = () => {
    let { filter } = payload;

    valid.isObjValid(filter, "outlet_id", "E20033BE", true);
    valid.isObjValid(filter, "room_id", "E20100BE", true);

    filter.license = BSON.ObjectId(user.license.toString());
    filter.outlet = BSON.ObjectId(filter.outlet_id.toString());
    filter.room_id = BSON.ObjectId(filter.room_id.toString());

    delete filter.outlet_id;
  };

  const dbListTable = () => {
    let { filter } = payload;

    return db
      .collection(collectionNames.tables)
      .aggregate([
        { $match: filter },
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
            label: 1,
            pax: 1,
            location_x: 1,
            location_y: 1,
            location_z: 1,
            status: 1,
            outlet: { _id: 1, name: 1 },
          },
        },
      ])
      .toArray();
  };

  const listReturnFormat = (rawData) => {
    return rawData.map((v) => {
      const {
        _id,
        label,
        pax,
        location_x,
        location_y,
        location_z,
        status,
        outlet: [{ _id: outlet_id, name: outlet_name }],
      } = v;

      return {
        id: _id.toString(),
        label,
        pax,
        location: {
          x: location_x,
          y: location_y,
          z: location_z,
        },
        status,
        outlet_id: outlet_id.toString(),
        outlet_name,
      };
    });
  };

  const getOldData = async () => {
    // Pengecekan selain berdasarkan payload id, juga berdasarkan titik xyz, jika lokasinya sama persis, dan ruangannya sama, data yang sudah ada tersebut diedit
    // revisi => ketika xyz sama, tidak di izinkan menyimpan table karen table sudah terisi
    const {
      filter,
      data: { location, room_id },
    } = payload;
    if (filter._id) {
      // query by id normal
      const oldData = await db
        .collection(collectionNames.tables)
        .findOne({ ...filter }, { _id: 1, room_id: 1 });

      if (!oldData) throw new Error("E30053BE");

      return oldData;
    } else {
      // query by exact location
      const exactData = await db.collection(collectionNames.tables).findOne(
        {
          location_x: location.x,
          location_y: location.y,
          location_z: location.z,
          room_id: BSON.ObjectId(room_id),
          license: filter.license,
        },
        { _id: 1, room_id: 1 }
      );

      if (exactData) {
        throw new Error("E30086BE");
      }
    }

    return false;
  };

  const buildPostFilter = () => {
    payload.filter = {
      // default filter
      license: BSON.ObjectId(user.license.toString()),

      // payload filter
      outlet: BSON.ObjectId(payload.data.outlet_id.toString()),
    };

    if (payload.data.id) {
      payload.filter._id = BSON.ObjectId(payload.data.id.toString());
    }
  };

  const dataValidator = async () => {
    // validate ACL tapi tidak perlu throw error
    await valid.hasPermission(["bo_table"]);

    valid.isObjValid(payload.data, "label", "E20099BE", true);
    valid.isObjValid(payload.data, "room_id", "E20100BE", true);
    valid.isObjValid(payload.data, "outlet_id", "E20033BE", true);
    valid.isObjValid(payload.data, "pax", "E20102BE", false);

    await valid.isUnique(
      payload.data,
      collectionNames.tables,
      "label",
      "E30054BE"
    );

    buildPostFilter();
    if ((await validateRoom(payload)) == 0) {
      throw new Error("E30050BE");
    }
  };

  const validateRoom = ({ data: { room_id }, filter: { license, outlet } }) => {
    return db
      .collection(collectionNames.rooms)
      .count({ _id: BSON.ObjectId(room_id), license, outlet });
  };

  const handleSaveData = async (oldData) => {
    const {
      filter,
      data: { label, location, pax, room_id },
    } = payload;

    if (oldData) {
      // // update member
      filter._id = oldData._id;

      await db.collection(collectionNames.tables).updateOne(
        { ...filter },
        {
          $set: {
            user_id: BSON.ObjectId(user._id),
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user._id),

            label,
            name: label,
            location_x: parseFloat(location.x),
            location_y: parseFloat(location.y),
            location_z: parseFloat(location.z),
            room_id: BSON.ObjectId(room_id),
            pax: parseFloat(pax || 0),
          },
          $inc: { __v: 1 },
        }
      );

      return filter._id.toString();
    } else {
      // insert data
      const newData = await db.collection(collectionNames.tables).insertOne({
        _id: new BSON.ObjectId(),
        _partition: filter.outlet.toString(),
        __v: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: BSON.ObjectId(user._id),
        updatedBy: BSON.ObjectId(user._id),
        license: filter.license,
        outlet: filter.outlet,
        user_id: BSON.ObjectId(user._id),

        label,
        name: label,
        location_x: parseFloat(location.x),
        location_y: parseFloat(location.y),
        location_z: parseFloat(location.z),
        room_id: BSON.ObjectId(room_id),
        pax: parseFloat(pax || 0),
        status: "available",

        // default data dan belum digunakan
        background_color: "",
        border_radius_bottom_left: parseFloat(0),
        border_radius_bottom_right: parseFloat(0),
        border_radius_top_left: parseFloat(0),
        border_radius_top_right: parseFloat(0),
        color: "",
        font_family: "Arial",
        font_size: parseFloat(0),
        font_weight: 0,
        size_height: parseFloat(0),
        size_width: parseFloat(0),
        trans_date: new Date(),
        used_pax: parseFloat(0),

        // masih belum digunakan
        // shape_id:new BSON.ObjectId(),
        // transaction_id:new BSON.ObjectId(),
      });

      await addTableToRoom(payload, newData.insertedId);

      return newData.insertedId.toString();
    }
  };

  const addTableToRoom = async (
    { data: { room_id }, filter: { license, outlet } },
    table_id
  ) => {
    // tambahkan table ke schema room pada field `tables`
    await db.collection(collectionNames.rooms).updateOne(
      { _id: BSON.ObjectId(room_id), license, outlet },
      {
        $push: {
          tables: table_id,
        },
      }
    );
  };

  return Object.freeze({ POST, LIST, DELETE });
};
