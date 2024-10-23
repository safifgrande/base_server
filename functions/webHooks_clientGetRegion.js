module.exports = async function (payload, response) {
  try {
    const country = await context.services
      .get("mongodb-atlas")
      .db("CORE_DB")
      .collection("master_reg_country");

    const query = await country
      .aggregate([
        { $match: { name: "Indonesia" } },
        { $project: { _id: 1, name: 1, code: 1 } },
      ])
      .toArray();

    const listReturnFormat = (country_list) => {
      return country_list.map((v) => {
        v.id = v._id.toString();
        delete v._id;
        return v;
      });
    };

    return listReturnFormat(query);
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "webhooks_clientGetRegion"
    );
  }
};
