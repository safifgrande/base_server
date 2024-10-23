module.exports = async (payload) => {
  try {
    const businessObject = await business(payload);
    const { method } = payload;
    if (businessObject[method]) {
      return await businessObject[method]();
    } else {
      return true;
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientUserBusiness"
    );
  }
};

const business = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { user_business } = context.values.get("COLLECTION_NAMES");

  const { _id: user_id, license } = context.functions.execute("intUserContext");

  /*
    Business memiliki outlet, bukan outlet memiliki business,
    jadi parameter outlet dalam filter dana partition di hilangkan

    {
      method: 'POST',
      data: {
        name: "BISNIS BARU 1",
        business_category_id: "5ff53a55000b5eacad347f68",
      }
    }

    1. initate filter
    2. validation
    3. save bisnis
  */
  const POST = async () => {
    // 1. initate filter
    POSTInitiateFilter();

    // 2. validation
    await validation();

    // 3. save bisnis
    return handleSaveBusiness();
  };

  // exports({
  //   method: "GET",
  //   headers: { Lang: "id" },
  //   data: {},
  //   filter: {
  //     hide_empty_outlet: false,
  //   },
  // })

  const GET = async () => {
    return dbGETBusiness();
  };

  // Helper function
  const POSTInitiateFilter = () => {
    payload.filter = {
      // default filter
      license,
    };

    if (payload.data.id) {
      payload.filter._id = BSON.ObjectId(payload.data.id.toString());
    }
    delete payload.data.id;
  };

  const validation = async () => {
    valid.isObjValid(payload.data, "name", "E20065BE", true);
    valid.isObjValid(payload.data, "business_category_id", "E20066BE", true);

    // search duplicate name
    await dbPOSTFindDuplicate();
  };

  /*
    WARNING: jika revisi bagian ini, RF clientOutlets menggunakan-nya
            pastikan RF clientOutlets juga di update
  */
  const handleSaveBusiness = async () => {
    const { filter } = payload;
    if (filter._id) {
      // belum ada action yang mebutuhkan update business
      return filter._id.toString();
    } else {
      // insert new business
      return (await dbPOSTInsertBusiness()).insertedId.toString();
    }
  };
  // ================

  // Database query helper =====
  const dbPOSTFindDuplicate = async () => {
    const {
      filter,
      data: { name, business_category_id },
    } = payload;

    const filterDuplicate = {
      ...filter,
      name,
      category: BSON.ObjectId(business_category_id),
    };

    if (filter._id) {
      filterDuplicate._id = { $ne: filter._id };
    }

    const duplicateName = await db
      .collection(user_business)
      .count(filterDuplicate);
    if (duplicateName > 0) {
      throw new Error("E30124BE");
    }
  };

  const dbPOSTInsertBusiness = async () => {
    const {
      data: { business_category_id, name },
    } = payload;

    return db.collection(user_business).insertOne({
      _id: new BSON.ObjectId(),
      _partition: "", // business tidak sync, seharusnya tidak ada partition
      __v: 0,
      category: new BSON.ObjectId(business_category_id),
      name,
      outlet: [],
      user_id: BSON.ObjectId(user_id),
      license,
      active: true,
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user_id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),
    });
  };

  const dbGETBusiness = async () => {
    const { filter } = payload;
    const hideOutletQuery = [];

    if (filter.hide_empty_outlet) {
      hideOutletQuery.push(
        {
          $lookup: {
            from: "outlet",
            let: {
              ids: "$outlet",
            },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", "$$ids"] },
                },
              },
              {
                $project: {
                  _id: 1,
                },
              },
            ],
            as: "outlet",
          },
        },
        {
          $match: {
            outlet: { $exists: true, $ne: [] },
          },
        },
        {
          $unset: "outlet",
        }
      );
    }

    return db
      .collection(user_business)
      .aggregate([
        {
          $match: {
            license,
          },
        },
        {
          $lookup: {
            from: "master_business_category",
            let: {
              id: "$category",
            },
            pipeline: [
              {
                $match: {
                  _id: "$$id",
                },
              },
              {
                $project: {
                  _id: 0,
                  id: { $toString: "$_id" },
                  name: 1,
                },
              },
            ],
            as: "category",
          },
        },
        {
          $unwind: "$category",
        },
        ...hideOutletQuery,
        {
          $project: {
            _id: 0,
            id: { $toString: "$_id" },
            name: 1,
            active: 1,
            category: 1,
            has_outlet: {
              $cond: {
                if: { $eq: ["$outlet", []] },
                then: false,
                else: true,
              },
            },
          },
        },
      ])
      .toArray();
  };
  // ===========================

  return Object.freeze({ POST, GET });
};
