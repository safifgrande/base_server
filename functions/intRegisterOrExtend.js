module.exports = function () {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const generateInvoice = async () => {
    const lastLicensePayment = await dbGetLastPayment();
    const yearNow = new Date().getFullYear();

    let counter = 1;
    if (lastLicensePayment.length > 0) {
      const yearLicense = new Date(
        lastLicensePayment[0].createdAt
      ).getFullYear();

      // jika tahun server salah
      if (yearNow < yearLicense) {
        throw new Error("E30127BE");
      } else if (yearNow === yearLicense) {
        counter = Number(lastLicensePayment[0].invoiceNumber.slice(-8)) + 1;
      }
    }

    counter = counter.toString().padStart(8, "0");
    return `INV${new Date().getFullYear().toString().slice(2)}${counter}`;
  };

  const getLastLicense = async (filter = {}) => {
    const lastLicenseDevice = await db
      .collection(collectionNames.user_license_device)
      .find(
        {
          license_label: {
            $regex: "^LICENSE.*",
          },
          ...filter,
        },
        {
          license_label: 1,
        }
      )
      .sort({ _id: -1 })
      .limit(1)
      .toArray();

    if (lastLicenseDevice.length > 0)
      return parseInt(
        lastLicenseDevice[0].license_label.replace("LICENSE ", "")
      );

    return 0;
  };

  const dbGetLastPayment = async () => {
    return await db
      .collection(collectionNames.user_license_payment)
      .find(
        {
          invoiceNumber: {
            $regex: "^INV.*",
          },
        },
        { invoiceNumber: 1, createdAt: 1 }
      )
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
  };

  return Object.freeze({
    generateInvoice,
    getLastLicense,
  });
};
