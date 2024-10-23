/*
  exports({
    method: 'POST',
    data: {
      outlet_id: '',
      rooms: [
        // kirim semua yang aktif saja (baik yang ada perubahan dan tidak ada perubahan, auto delete sudah dihandle di RF)
        {
          id: '',
          label: ''
        }
      ]
    }
  })
  
  {
    method: 'LIST',
    filter: {
      outlet_id: ""
    }
  }
*/

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
      "clientRoom"
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

  const LIST = async () => {
    await validationLIST();

    const raw_data = await queryLIST();

    return formatReturnLIST(raw_data);
  };

  const validationLIST = async () => {
    if (!(await valid.hasPermission(["bo_table"], false))) {
      return [];
    }

    let { filter } = payload;

    if (!filter) {
      filter = {};
    }

    valid.isObjValid(filter, "outlet_id", "E20033BE", true);

    filter.license = BSON.ObjectId(user.license.toString());

    if (filter.outlet_id) {
      filter.outlet = BSON.ObjectId(filter.outlet_id.toString());
    }

    delete filter.outlet_id;
  };

  const queryLIST = async () => {
    const { filter } = payload;

    return db
      .collection(collectionNames.rooms)
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
            name: 1,
            label: 1,
            products: 1,
            department: { _id: 1, name: 1 },
            outlet: { _id: 1 },
          },
        },
      ])
      .toArray();
  };

  const formatReturnLIST = (rawData) => {
    return rawData.map((v) => {
      const {
        _id,
        name,
        label,
        outlet: [{ _id: outlet_id }],
      } = v;

      return {
        id: _id.toString(),
        name,
        label,
        outlet_id: outlet_id.toString(),
      };
    });
  };

  // 1.
  const POST = async () => {
    // build filter
    postFilterValidation();

    await userValidator();

    // 1. data dibagi 2
    // a. data yang berubah akan disimpan, data yang gakberubah abaikan
    // b. data yang ada di db, tapi tidak ada di payload, akan dihapus
    let normalizeData = await normalize(payload.data.rooms);
    let result = [];

    // 2. validasi setiap room yang dikirim
    await dataValidator(normalizeData.dataToSave);

    // 3. hapus semua data yang tidak ada dalam payload
    if (
      Array.isArray(normalizeData.dataNotInPayload) &&
      normalizeData.dataNotInPayload.length > 0
    ) {
      const data_not_in_payload = normalizeData.dataNotInPayload.reduce(
        (prev, curr) => {
          if (curr.tables.length > 0) throw new Error("E30085BE");

          return [...prev, curr._id];
        },
        []
      );

      await handleDeleteData(data_not_in_payload);
    }

    // 4. proses simpan data dari normalize data diatas
    if (
      Array.isArray(normalizeData.dataToSave) &&
      normalizeData.dataToSave.length > 0
    ) {
      await handleSaveData({
        newData: normalizeData.dataToSave.filter((v) => !v.id),
        editedData: normalizeData.dataToSave.filter((v) => v.id),
        result,
      });
    }
    return result;
  };

  const normalize = async (payloadRoom) => {
    const { filter } = payload;
    const currentServerData = await db
      .collection(collectionNames.rooms)
      .aggregate([
        {
          $match: { ...filter },
        },
        {
          $lookup: {
            from: "tables",
            localField: "_id",
            foreignField: "room_id",
            as: "tables",
          },
        },
        {
          $project: { _id: 1, label: 1, tables: { _id: 1 } },
        },
      ])
      .toArray();

    let result = {
      dataToSave: [],
      dataNotInPayload: [],
    };

    if (Array.isArray(payloadRoom) && payloadRoom.length > 0) {
      // 1. memasukkan data yang akan disimpan saja
      payloadRoom.forEach((room) => {
        if (room.id) {
          let index = currentServerData.findIndex(
            (data) => data._id.toString() === room.id.toString()
          );
          // Jika ada perubahan nama, tambahkan ke normalize data untuk disimpan, jika tidak berubah, gausah di save
          if (currentServerData[index]?.label !== room.label) {
            result.dataToSave = [...result.dataToSave, { ...room }];
          }
        } else {
          result.dataToSave = [...result.dataToSave, { ...room }];
        }
      });
      // 2. memasukkan data yang tidak di cantumkan di payload, langsung delete
      if (Array.isArray(currentServerData) && currentServerData.length > 0) {
        // data server dijadikan array of string id
        // let arrayOfIdServerData = currentServerData.map((data) =>
        //   BSON.ObjectId(data._id.toString())
        // );

        // data payload dijadikan array of string id dan yang id nya '' jangan dimasukkan array
        let arrayOfIdPayload = payloadRoom
          .filter((data) => data.id)
          .map((data) => BSON.ObjectId(data.id.toString()));

        result.dataNotInPayload = currentServerData.filter((data) => {
          let index = arrayOfIdPayload.findIndex(
            (room) => room.toString() === data._id.toString()
          );
          return index === -1;
        });
      }
    }

    return result;
  };

  const getOldData = async (id) => {
    const { filter } = payload;

    const oldData = await db
      .collection(collectionNames.rooms)
      .find({ ...filter, _id: { $in: id } }, { _id: 1 })
      .toArray();

    return oldData;
  };

  const postFilterValidation = () => {
    valid.isObjValid(payload.data, "outlet_id", "E20033BE", true);

    payload.filter = {
      // default filter
      license: BSON.ObjectId(user.license.toString()),

      // payload filter
      outlet: BSON.ObjectId(payload.data.outlet_id.toString()),
    };
    delete payload.data.outlet_id;
  };

  const userValidator = async () => {
    // validate ACL tapi tidak perlu throw error
    if (!(await valid.hasPermission(["bo_table"], false))) {
      return [];
    }
  };

  const dataValidator = async (rooms) => {
    if (Array.isArray(rooms) && rooms.length > 0) {
      valid.isObjValid(payload.filter, "outlet", "E20033BE", true);

      // a. check is rooms has duplicate name value?
      if (payload.data.rooms.length > 1) {
        const uniqueName = [
          ...new Set(payload.data.rooms.map((v) => v.label.toLowerCase())),
        ];
        if (uniqueName.length < payload.data.rooms.length) {
          throw new Error("E30051BE"); // not unique
        }
      }

      // b. check is rooms unique?
      await roomNameValidation(rooms);

      // c. check is rooms with id exist in db?
      await checkRoomsId(rooms);
    }
  };

  const roomNameValidation = async (rooms) => {
    const list_rooms = rooms.map((room) => {
      valid.isObjValid(room, "label", "E20095BE", true);

      return {
        id: !room?.id ? "" : room.id.toString(),
        label: room.label.toLowerCase(),
      };
    });

    const get_list_rooms = await db
      .collection(collectionNames.rooms)
      .find(
        {
          outlet: BSON.ObjectId(payload.filter.outlet.toString()),
          license: BSON.ObjectId(user.license.toString()),
        },
        {
          _id: 1,
          label: 1,
        }
      )
      .toArray();

    list_rooms.forEach((v) => {
      if (v.id) {
        if (
          get_list_rooms.find(
            (el) =>
              el._id.toString() !== v.id && el.label === v.label.toLowerCase()
          )
        ) {
          throw new Error("E30051BE");
        }
      }
    });
  };

  const checkRoomsId = async (rooms) => {
    const list_rooms_id = rooms.reduce((prev, curr) => {
      curr.id && prev.push(BSON.ObjectId(curr.id.toString()));
      return prev;
    }, []);

    if (list_rooms_id.length > 0) {
      const oldData = await getOldData(list_rooms_id);
      if (oldData.length !== list_rooms_id.length) {
        throw new Error("E30050BE");
      }
    }
  };

  const handleSaveData = async ({ newData, editedData, result }) => {
    const { filter } = payload;

    if (editedData.length > 0) {
      //update all edited data
      const updateRoom = editedData.map((data) => {
        return {
          updateOne: {
            filter: {
              ...filter,
              _id: BSON.ObjectId(data.id.toString()),
            },
            update: {
              $set: {
                user_id: BSON.ObjectId(user._id),
                updatedAt: new Date(),
                updatedBy: BSON.ObjectId(user._id),
                name: data.label,
                label: data.label,
              },
              $inc: { __v: 1 },
            },
          },
        };
      });

      await db.collection(collectionNames.rooms).bulkWrite(updateRoom);
      result.push(...editedData.map((v) => v.id.toString()));
    }

    if (newData.length > 0) {
      // insert all new data
      const newRoom = newData.map((data) => {
        return {
          insertOne: {
            document: {
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
              label: data.label,
              // default data not from UI
              name: data.label,
              image_background: "-",
              tables: [],
            },
          },
        };
      });

      await db.collection(collectionNames.rooms).bulkWrite(newRoom);
      result.push(...newRoom.map((v) => v.insertOne.document._id.toString()));
    }

    return result;
  };

  const handleDeleteData = async (deletedRooms) => {
    await db.collection(collectionNames.rooms).deleteMany({
      _id: { $in: deletedRooms },
      license: payload.filter.license,
    });
  };

  return Object.freeze({ POST, LIST });
};
