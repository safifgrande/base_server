module.exports = (coll, aggr) => {
  try {
    const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
    const db = mongodb.db(context.values.get("DB_NAME"));
    return db.collection(coll).aggregate(aggr).toArray();
  } catch (error) {
    context.functions.execute("handleCatchError", error, "", "intSystemQuery");

    return [];
  }
};
