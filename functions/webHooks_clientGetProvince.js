// This function is the webhook's request handler.
exports = async function (payload) {
  //Execute application logic, such as working with MongoDB
  try {
    const body = EJSON.parse(payload.body.text());
    if (!body.id) throw new Error("E20106BE");

    const province = await context.services
      .get("mongodb-atlas")
      .db("CORE_DB")
      .collection("master_reg_state");

    const query = await province
      .aggregate([
        {
          $match: {
            active: true,
            country: BSON.ObjectId(body.id),
          },
        },
        { $project: { _id: 1, name: 1, lowerName: { $toLower: "$name" } } },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();

    const listReturnFormat = (province_list) => {
      return province_list.map((v) => {
        v.id = v._id.toString();
        delete v._id;
        delete v.lowerName;
        return v;
      });
    };

    return listReturnFormat(query);
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientGetProvince"
    );
  }
  // // This return value does nothing because we already modified the response object.
  // // If you do not modify the response object and you enable *Respond with Result*,
  // // Realm will include this return value as the response body.
};
