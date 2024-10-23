module.exports = async function (payload, response) {
  try {
    const business = await context.services
      .get("mongodb-atlas")
      .db("CORE_DB")
      .collection("master_business_category");
    const query = await business
      .find({ active: true }, { _id: 1, name: 1 })
      .toArray();

    query.map((v) => {
      v.id = v._id.toString();

      delete v._id;
      return v;
    });

    // Respond with an affirmative result
    response.setStatusCode(200);
    response.setBody(JSON.stringify(query));
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientBusinessCategory"
    );
  }

  // This return value does nothing because we already modified the response object.
  // If you do not modify the response object and you enable *Respond with Result*,
  // Realm will include this return value as the response body.
  return { msg: "finished!" };
};
