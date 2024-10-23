exports = async (payload) => {
  try {
    const billingHistory = generalFunction(payload);

    const { method } = payload;
    if (billingHistory[method]) {
      return await billingHistory[method]();
    } else {
      return "method is not exist";
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientBillingHistory"
    );
  }
};

const generalFunction = (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { user_license_payment } = context.values.get("COLLECTION_NAMES");

  const { license } = context.functions.execute("intUserContext");

  /*
    exports({
      "method":"LIST",
      "data":{},
      "filter":{},
    })
  */

  const LIST = async () => {
    await billigFilterAndValidation();

    const billing_list = await getBillingList();

    return returnBillingformat(billing_list);
  };

  /*
    exports({
      "method":"GET",
      "data":{},
      "filter":{
        id: 'id'
      },
    })
  */

  const GET = async () => {
    await getFilterAndValidation();

    const billing_detail = await getDetailBilling();


    if (billing_detail.length == 0) {
      throw new Error("E30093BE");
    }

    return detailBillingReturn(billing_detail[0]);
  };

  const detailBillingReturn = (detail) => {
    const taxes = (detail.tax / 100) * detail.sub_total;

    detail.total_details = [
      {
        label: "Sub Total",
        value: detail.sub_total > 0 ? detail.sub_total : detail.sub_total === 0 ? 0 : "",
      },
      // {
      //   label: "Diskon/Promo", //TODO : dipakek kalau sudah menerapkan promo / diskon
      //   value: "-",
      // },
      {
        label: `PPN ${taxes === 0 ? 0 : detail.tax}%`,
        value: taxes > 0 ? taxes : taxes === 0 ? 0 : "",
      },
      {
        label: "Total",
        value: detail.grandTotal,
      }
    ];

    detail.devices = detail.devices.map((eachdevice) => {
      const detailExpired =
        detail?.detailDevicesExpired?.length > 0
          ? detail.detailDevicesExpired.find(
            (e) => e.devices == eachdevice._id.toString()
          )
          : [];

      let prev_expired = detailExpired?.prevExpired ? new Date(
        detailExpired?.prevExpired
      ) : null

      let next_expired = new Date(
        detailExpired?.newExpired || eachdevice.expired
      );

      if (detail.status == "cancel") {
        next_expired = "";
      }

      return {
        id: eachdevice._id.toString(),
        label: eachdevice.license_label,
        pos_id: eachdevice.pos_id?.name || "",
        outlet: eachdevice.outlet?.name || "",
        business: eachdevice.business?.name || "",
        price: detail.price,
        prev_expired,
        next_expired,
      };
    });

    return {
      id: detail._id.toString(),
      invoice_number: detail.invoiceNumber,
      business_plan_label: detail.license_name ?? detail.master_license?.name,
      business_plan_price: detail.price,
      status: detail.status,
      payment_date: detail.updatedAt,
      payment_url: detail?.xendit_invoice_url || "",
      devices: detail.devices,
      total_details: detail.total_details,
    };
  };

  const getDetailBilling = async () => {
    const { filter } = payload;

    return db
      .collection(user_license_payment)
      .aggregate([
        { $match: filter }, // need license
        {
          $lookup: {
            from: "master_license",
            localField: "masterLicenseId",
            foreignField: "_id",
            as: "master_license",
          },
        },
        {
          $unwind: {
            path: "$master_license",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "user_license_device",
            let: { devices: { $ifNull: ["$devices", []] } },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", "$$devices"] },
                },
              },
              {
                $lookup: {
                  from: "pos_ids",
                  localField: "pos_id",
                  foreignField: "_id",
                  as: "pos_id",
                },
              },
              {
                $unwind: {
                  path: "$pos_id",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "outlet",
                  localField: "pos_id.outlet",
                  foreignField: "_id",
                  as: "outlet",
                },
              },
              {
                $unwind: {
                  path: "$outlet",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "user_business",
                  localField: "outlet.business_id",
                  foreignField: "_id",
                  as: "business",
                },
              },
              {
                $unwind: {
                  path: "$business",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $project: {
                  _id: 1,
                  license_label: 1,
                  expired: 1,
                  pos_id: {
                    name: 1,
                  },
                  outlet: {
                    name: 1,
                  },
                  business: {
                    name: 1,
                  },
                },
              },
            ],
            as: "devices",
          },
        },
        {
          $project: {
            invoiceNumber: 1,
            sub_total: 1,
            tax: 1,
            status: 1,
            grandTotal: 1,
            updatedAt: 1,
            price: 1,
            xendit_invoice_url: 1,
            detailDevicesExpired: 1,
            master_license: {
              name: 1,
            },
            license_duration: 1,
            license_name: 1,
            devices: {
              _id: 1,
              license_label: 1,
              expired: 1,
              pos_id: {
                name: 1,
              },
              outlet: {
                name: 1,
              },
              business: {
                name: 1,
              },
            },
          },
        },
      ])
      .toArray();
  };

  const getFilterAndValidation = async () => {
    await valid.hasPermission(["bo_account_settings"]);

    let { filter } = payload;

    valid.isObjValid(filter, "id", "E20106BE", true);

    filter.license = license;
    filter._id = BSON.ObjectId(payload.filter.id.toString());

    delete filter.id;
  };

  const returnBillingformat = (billing_list) => {
    return billing_list.map((billing) => {
      billing.devices = billing.devices.map((eachdevice) => {
        return {
          id: eachdevice._id.toString(),
          label: eachdevice.license_label,
          pos_id: eachdevice.pos_id ? eachdevice.pos_id.name : "",
          outlet: eachdevice.outlet ? eachdevice.outlet.name : "",
          business: eachdevice.business ? eachdevice.business.name : "",
        };
      });

      return {
        id: billing._id.toString(),
        invoice_number: billing.invoiceNumber,
        bill_total: billing.grandTotal,
        transaction_date: billing.createdAt,
        payment_media: billing.payment_media ? billing.payment_media.name : "",
        due_date: billing.xendit_expiry_date,
        devices: billing.devices,
        status: billing.status,
        total_device: billing.totalDevicesPaid,
      };
    });
  };

  const getBillingList = async () => {
    return db
      .collection(user_license_payment)
      .aggregate([
        { $match: payload.filter }, // need license
        {
          $lookup: {
            from: "user_license_device",
            let: { devices: { $ifNull: ["$devices", []] } },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", "$$devices"] },
                },
              },
              {
                $lookup: {
                  from: "pos_ids",
                  localField: "pos_id",
                  foreignField: "_id",
                  as: "pos_id",
                },
              },
              {
                $unwind: {
                  path: "$pos_id",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "outlet",
                  localField: "pos_id.outlet",
                  foreignField: "_id",
                  as: "outlet",
                },
              },
              {
                $unwind: {
                  path: "$outlet",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $project: {
                  _id: 1,
                  license_label: 1,
                  pos_id: {
                    name: 1,
                  },
                  outlet: {
                    name: 1,
                  },
                },
              },
            ],
            as: "devices",
          },
        },
        {
          $lookup: {
            from: "pos_ids",
            localField: "device.pos_id",
            foreignField: "_id",
            as: "pos_id",
          },
        },
        {
          $lookup: {
            from: "license_payment_media",
            localField: "payment_media_id",
            foreignField: "_id",
            as: "payment_media",
          },
        },
        {
          $unwind: {
            path: "$payment_media",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            invoiceNumber: 1,
            createdAt: 1,
            totalDevicesPaid: 1,
            grandTotal: 1,
            xendit_expiry_date: 1,
            status: 1,
            updatedAt: 1,
            devices: {
              _id: 1,
              license_label: 1,
              pos_id: {
                name: 1,
              },
              outlet: {
                name: 1,
              },
            },
            payment_media: {
              name: 1,
            },
          },
        },
        { $sort: { updatedAt: -1 } },
      ])
      .toArray();
  };

  const billigFilterAndValidation = async () => {
    await valid.hasPermission(["bo_account_settings"]);

    let { filter } = payload;
    filter.license = license;
  };

  return Object.freeze({ LIST, GET });
};
