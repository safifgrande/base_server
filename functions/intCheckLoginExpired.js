module.exports = async (payload) => {
  // flow yang baru berdasarkan pos id nya
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const license = await db
    .collection(collectionNames.user_license_device)
    .find({
      expired: { $gte: new Date() },
      license: payload.user.license,
      active: true,
    })
    .toArray();

  if (!license || license.length === 0) throw new Error("E30007BE");

  return license[0];
};
