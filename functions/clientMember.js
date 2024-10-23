module.exports = async (payload) => {
  try {
    const masterRequest = await masterFunction(payload);
    if (masterRequest[payload.method]) {
      return await masterRequest[payload.method]();
    }

    throw new Error("Method not found in request");
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientMember"
    );
  }
};

const masterFunction = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { member } = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  /*
    exports({
      method: 'LIST',
      filter: {
        business_id: [string | required | business ID],
        outlet_id: [string | optional | Outlet ID],
        active: [boolean | optional | Member active status],
        page: [number | required | page number to show],
        limit: [number | required | data limit per page to show]
      }
    })

    1. validation
    2. fetch member
    3. build response
  */
  const LIST = async () => {
    // 1. validation
    await LISTValidation();

    // 2. fetch member
    const memberData = await dbLISTFetchMember();

    // 3. build response
    return LISTBuildResponse(memberData);
  };

  /*
    {
      method: 'GET',
      filter: {
        id: '600a3cfe7666c9a35f29c9c5'
      }
    }

    1. validate ACL
    2. get member from DB
  */
  const GET = async () => {
    // 1. validate ACL
    if (!(await valid.hasPermission(["bo_member"], false))) {
      return [];
    }

    // 2. get member from DB
    const {
      _id,
      outlet: { _id: outlet_id, name: outlet_name },
      ...memberData
    } = await dbGETMember();

    return {
      id: _id.toString(),
      outlet_id: outlet_id.toString(),
      outlet_name,
      ...memberData,
    };
  };

  /*
    {
      method: 'POST',
      data: {
        id: "",
        outlet_id: "600548af5009e654231c0276",
        member_id: "",
        name: "Nama Pelanggan",
        phone: "+62128937819273",
        email: "ami@amiami@ami",
        gender: "male",
        birthday: new Date(),
        image_url: "http://bunny",
        expiry_date: new Date(),
        address: "Jalan Raya Besar",
        city: "Malang",
        office_address: "Jalan Raya Kecil",
        office_city: "Surabaya",
        active: true,
      }
    }

    1. validation
    2. validate payload with data from DB
    3. build filter for query
    4. get old data
    5. generate member id
    6. save data
  */
  const POST = async () => {
    // 1. validation
    POSTPayloadValidation();

    // 2. validate payload with data from DB
    await POSTDBValidation();

    // 3. build filter for query
    buildFilter();

    // 4. get old data
    const oldData = await dbPOSTOldData();

    // 5. generate member id
    await generateMemberId(oldData);

    // 6. save data
    return handleSave(oldData);
  };

  /*
    exports({
      method: 'ACTIVE',
      data: {
        active: true
      },
      filter: {
        id: '6020c9292f23ff5b4b396e35'
      }
    })
  */
  const ACTIVE = async () => {
    // 1. validation
    await ACTIVEValidation();

    // 2. update member
    return dbACTIVEMember();
  };

  /*
    exports({
      "method":"SEARCH",
      "filter":{
        business_id: [string | required | business ID],
        outlet_id: [string | optional | Outlet ID],
        active: [boolean | optional | Member active status],
        page: [number | required | page number to show],
        limit: [number | required | data limit per page to show]
        "search_text": [string | optional | text to search],
      }
    })

    1. validation
    2. fetch member
    3. build response
  */
  const SEARCH = async () => {
    // 1. validation
    await SEARCHValidation();

    // 2. fetch member
    const memberData = await dbLISTFetchMember();

    // 3. build response
    return LISTBuildResponse(memberData);
  };

  // database function
  const dbGetSequencialMemberId = async (year) => {
    const { license } = user;
    const {
      filter: { outlet },
    } = payload;
    return db
      .collection(member)
      .find(
        {
          license,
          outlet,
          member_id: { $regex: `^${year}[0-9]{5}$` },
        },
        { member_id: 1 }
      )
      .sort({ member_id: -1 })
      .limit(1)
      .toArray();
  };

  const dbLISTFetchMember = async () => {
    const {
      filter: {
        outlet_id,
        business_id,
        page,
        limit,
        active,
        search_text,
        sort_type,
        sort_by,
      },
    } = payload;

    const filter = {
      license: user.license,
      active: active ?? true,
    };

    if (search_text) {
      filter["$or"] = [
        { name: { $regex: search_text, $options: "i" } },
        { member_id: { $regex: search_text, $options: "i" } },
      ];
    }

    if (outlet_id) {
      filter.outlet = BSON.ObjectId(outlet_id.toString());
    } else {
      filter.outlet = {
        $in: await context.functions.execute(
          "intOutletsFromBusiness",
          business_id
        ),
      };
    }

    let sort = { $sort: { lowerName: sort_type ?? 1 } };

    // kalau ada payload sort_by harus ada sort_type , kalau tidak sorting akan default
    if (sort_by && sort_type) {
      if (sort_by !== "name") {
        const obj_sort = {};
        obj_sort[sort_by] = sort_type;
        sort = { $sort: obj_sort };
      }
    }
    delete filter.sort_by;
    delete filter.sort_type;

    const memberData = await db
      .collection(member)
      .aggregate([
        {
          $facet: {
            data: [
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
                  member_id: 1,
                  name: 1,
                  email: 1,
                  total_visit: 1,
                  total_spent: 1,
                  active: 1,
                  outlet_id: { $toString: "$outlet._id" },
                  outlet_name: "$outlet.name",
                  lowerName: { $toLower: "$name" },
                },
              },
              sort,
              { $skip: page > 0 ? (page - 1) * limit : 0 },
              { $limit: limit },
            ],
            totalData: [
              {
                $match: filter,
              },
              { $count: "count" },
            ],
          },
        },
      ])
      .toArray();

    memberData[0].totalData = memberData[0].totalData[0]?.count || 0;
    return memberData[0];
  };

  const dbGETMember = async () => {
    const {
      filter: { id },
    } = payload;

    const filter = {
      license: user.license,
      _id: BSON.ObjectId(id.toString()),
    };

    const memberData = await db
      .collection(member)
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
          $unwind: "$outlet",
        },

        {
          $unwind: {
            path: "$transaction",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            name: 1,
            member_id: 1,
            email: 1,
            phone: 1,
            birthday: 1,
            gender: 1,
            active: 1,
            expiry_date: 1,
            total_visit: 1,
            total_spent: 1,
            last_visit: 1,
            address: 1,
            city: 1,
            office_address: 1,
            office_city: 1,
            image_url: 1,
            outlet: { _id: 1, name: 1 },
          },
        },
      ])
      .toArray();

    if (!memberData) throw new Error("E30038BE");
    return memberData[0];
  };

  const dbACTIVEMember = async () => {
    const {
      data: { active },
      filter: { id },
    } = payload;

    const filter = {
      license: user.license,
      _id: BSON.ObjectId(id.toString()),
    };

    const updatedMember = await db.collection(member).findOneAndUpdate(
      filter,
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id),
          active,
        },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1 },
      }
    );

    if (!updatedMember) {
      throw new Error("E30038BE");
    }

    return id;
  };

  const dbPOSTOldData = async () => {
    const { filter } = payload;
    if (filter._id) {
      const oldData = await db
        .collection(member)
        .findOne({ ...filter }, { _id: 1, member_id: 1, image_url: 1 });
      if (!oldData) throw new Error("E30038BE");

      return oldData;
    }

    return false;
  };

  const dbPOSTNewMember = async () => {
    const { filter, data } = payload;
    const newMember = {
      _id: new BSON.ObjectId(),
      __v: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: BSON.ObjectId(user._id),
      updatedBy: BSON.ObjectId(user._id),
      user_id: BSON.ObjectId(user._id),
      _partition: filter.outlet.toString(),
      license: filter.license,
      outlet: filter.outlet,
      birthday: data.birthday ? new Date(data.birthday) : null,
      expiry_date: new Date(data.expiry_date),

      member_id: data.member_id,
      name: data.name,
      phone: data.phone,
      email: data.email,
      gender: data.gender,
      image_url: data.image_url,
      address: data.address,
      city: data.city,
      office_address: data.office_address,
      office_city: data.office_city,
      active: data.active,

      // default data not from UI
      card_no: "",
      invoice_limit: 100000000,
      last_visit: new Date(),
      member: false,
      payment_type: [],
      point: 0,
      total_spent: 0,
      total_visit: 0,
      balance_actual: 0,
      balance_bonus: 0,
      balance_total: 0,
    };
    // insert data
    return (
      await db.collection(member).insertOne(newMember)
    ).insertedId.toString();
  };

  const dbPOSTUpdateMember = async (oldData) => {
    const { filter, data } = payload;
    // check image
    if (
      oldData.image_url &&
      (data.image_url || data.image_url === "") &&
      oldData.image_url !== data.image_url
    ) {
      await context.functions.execute("intRemoveImage", {
        image_url: oldData.image_url,
      });
    }
    // update member
    await db.collection(member).updateOne(
      { ...filter },
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id),

          member_id: data.member_id,
          name: data.name,
          phone: data.phone,
          email: data.email ?? "",
          gender: data.gender,
          birthday: data.birthday ? new Date(data.birthday) : null,
          image_url: data.image_url,
          expiry_date: new Date(data.expiry_date),
          address: data.address,
          city: data.city,
          office_address: data.office_address,
          office_city: data.office_city,
          active: data.active,
        },
        $inc: { __v: 1 },
      }
    );

    return filter._id.toString();
  };

  // helper function
  const ACTIVEValidation = async () => {
    const { data, filter } = payload;

    await valid.hasPermission(["bo_member"]);
    valid.isObjValid(filter, "id", "E20072BE", true);
    valid.isObjValid(data, "active", "E20062BE", true);
  };

  const buildFilter = () => {
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

  const generateMemberId = async (oldData) => {
    if (oldData && !payload.data.member_id) {
      payload.data.member_id = oldData.member_id;
    } else if (!payload.data.member_id) {
      // IF THERE IS NO MEMBER ID
      const getYear = new Date().getFullYear().toString().slice(-2);
      let counter = "1";
      // QUERY MEMBER FILTERED MEMBER ID BY YEAR ON THE FIRST LETTER and HAS 5 DIGIT COUNTER
      let sequencialMember = await dbGetSequencialMemberId(getYear);

      if (sequencialMember.length > 0) {
        const currentMaxId = sequencialMember[0].member_id;
        // SLICE CURRENT MAX ID ERASE PREFIX YEAR, SO IT CONTAIN JUST THE COUNTER
        counter = (+currentMaxId.slice(2) + 1).toString();
      }
      // JOIN YEAR AND COUNTER
      payload.data.member_id = `${getYear}${counter.padStart(5, "0")}`;
    }
  };

  const POSTPayloadValidation = () => {
    // validate ACL
    valid.hasPermission("bo_member");

    valid.isObjValid(payload.data, "name", "E20067BE", true);
    valid.isObjValid(payload.data, "phone", "E20008BE", true);
    valid.isObjValid(payload.data, "gender", "E20068BE", true);
    valid.isObjValid(payload.data, "outlet_id", "E20033BE", true);
    valid.isGender(payload.data.gender, "E20149BE");
    valid.isObjValid(payload.data, "expiry_date", "E20130BE", true);
    if (payload.data.email) {
      valid.isEmail(payload.data.email, "E20007BE");
    }
    if (isNaN(new Date(payload.data.expiry_date))) {
      throw new Error("E20026BE");
    }
  };

  const POSTDBValidation = async () => {
    await valid.isUnique(payload.data, member, "member_id", "E30035BE");
    await valid.isUnique(payload.data, member, "phone", "E30036BE");
    await valid.isUnique(payload.data, member, "email", "E30037BE");
  };

  const handleSave = async (oldData) => {
    if (oldData) {
      return dbPOSTUpdateMember(oldData);
    } else {
      return dbPOSTNewMember();
    }
  };

  const LISTValidation = async () => {
    // validate ACL
    if (!(await valid.hasPermission(["bo_member"], false))) {
      return [];
    }

    // validation
    valid.isRequired(payload, "filter", "E20037BE");
    valid.isRequired(payload.filter, "limit", "E20109BE");
    valid.isRequired(payload.filter, "page", "E20109BE");
    valid.isRequired(payload.filter, "business_id", "E20110BE");
  };

  const SEARCHValidation = async () => {
    await LISTValidation();
  };

  const LISTBuildResponse = (memberData) => {
    const {
      filter: { limit, page },
    } = payload;

    if (!memberData) {
      return {
        totalData: 0,
        page: 1,
        totalPage: 0,
        data: [],
      };
    }
    const { totalData, data } = memberData;

    return {
      totalData,
      page,
      totalPage: Math.ceil(Number(totalData) / Number(limit)),
      data: data.map(({ _id, ...restMember }) => {
        delete restMember.lowerName;
        return {
          id: _id.toString(),
          ...restMember,
          total_spent: restMember.total_spent ? restMember.total_spent : 0,
        };
      }),
    };
  };

  return Object.freeze({ LIST, POST, GET, ACTIVE, SEARCH });
};
