module.exports = async (payload) => {
  try {
    const subs_object = await subsObject(payload);
    if (!subs_object[payload.method])
      throw new Error("Method not found in request");

    return await subs_object[payload.method]();
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientSubscription"
    );
  }
};

const subsObject = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();
  const intRegisterOrExtend = context.functions.execute("intRegisterOrExtend");
  const ENV = context.environment.tag;
  const email_server = context.environment.values.SETUP_EMAIL_SERVER;
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const {
    user_license_device,
    master_license,
    license_payment_media,
    user_license_payment,
    user_business,
    user,
  } = context.values.get("COLLECTION_NAMES");

  const { license, _id: user_id } = context.functions.execute("intUserContext");

  /*
    exports({
      "method":"LIST",
      "data":{},
      "filter":{},
    })
  */

  const LIST = async () => {
    await listValidationAndFilter();

    const list_user_license = await dbListUserLicenseDevice();

    return formatReturn(list_user_license);
  };

  /*
   exports({
     method: 'SUBSCRIBE',
     data: {
      business_plan_id: "610bf50d2c22594646654f1c", //required
      total_device: 2, // hapus saat extend
      license_devices: ['61a443441b6aaa25f590839b'], // hapus saat subscribe
      reinitiate: true
     },
     filter: {}
   })
  */

  const SUBSCRIBE = async () => {
    //validasi
    await subscribeValidation();

    //construct data to save
    let paymentLicense = await prepareDataToSave();

    // create xendit invoice
    const invoice = await createInvoice(paymentLicense);

    // reconstruct data
    paymentLicense = reConstructData(paymentLicense, invoice);

    //create payment license
    const license_id = await dbCreatePaymentLicense(paymentLicense);

    return {
      license_payment_id: license_id,
      payment_url: paymentLicense.xendit_invoice_url,
    };
  };

  /*
   exports({
     method: 'ADMIN_SUBSCRIBE',
     data: {
      license_id: "623bc29550dc4b4f6c9a6243", //required
      master_license_price_level:"6348c589a37b90d41562f84c", // required saat subscribe
      master_license_discount: "6348c589a37b90d41562f84d", // required saat subscribe
      payment_media_id: "6265f623f05a4b640c705f1e" // hapus saat subscribe
      business_plan_id: "61b7fe7f06a00716269bee97", //required
      total_device: 2, // hapus saat extend
      license_devices: ['623bc29550dc4b4f6c9a6245'] // hapus saat subscribe
      add_license:true // required saat add license
     },
     filter: {}
   })
  */

  const ADMIN_SUBSCRIBE = async () => {
    const { data } = payload;
    const type = data?.add_license ? "ADMIN_ADD_LICENSE" : "ADMIN_SUBSCRIBE";

    //validasi
    await adminSubscribeValidation();
    //construct data to save
    let paymentLicense = await prepareDataToSave(type);

    let license_id;

    // UNTUK SUBSCRIBE ACCOUNT BARU ATAU TAMBAH LICENSE VIA NON-TUNAI
    // UNTUK PAYMENT TUNAI MENGGUNAKAN RF ADMINREGISTERCLIENT
    if (paymentLicense.status === "pending") {
      // create xendit invoice
      const invoice = await createInvoice(paymentLicense);
      // reconstruct data
      paymentLicense = reConstructData(paymentLicense, invoice);

      license_id = await dbCreatePaymentLicense(paymentLicense);
    } else {
      // UNTUK EXTEND LICENSE

      //add paidDate & totalDevicesPaid
      paymentLicense.paidDate = new Date();
      paymentLicense.totalDevicesPaid = parseInt(data.total_device);
      //get user license device
      await dbGetDevicesList();
      // prepare data to update user license device
      const licenseDevices = extendLicenseDevices(paymentLicense);
      // update user license device
      await dbUpdateLicenseDevices(licenseDevices);

      license_id = await dbCreatePaymentLicense(paymentLicense);

      // send email
      await formatingAndSendEmail({
        _id: BSON.ObjectId(license_id.toString()),
      });
    }

    //create payment license
    return {
      license_payment_id: license_id,
      payment_url: paymentLicense.xendit_invoice_url || "",
    };
  };

  //--------------- Helper function ----------------
  const formatingAndSendEmail = async (filter) => {
    const detailBill = await dbGetDetailBilling(filter);
    const formatData = detailBillingFormat(detailBill[0]);

    const emailPayload = {
      to: formatData.user.email,
      from: "Grande POS <cs@grandepos.io>",
      subject: `Detail extends ${formatData.invoice_number}`,
      path: `${email_server}/extend`,
      body: {
        key: formatData.id,
        data: formatData,
      },
    };

    return context.functions.execute("intSendEmail", emailPayload);
  };

  const deviceResultBuilder = (curr, detail, prev_expired, next_expired) => {
    return {
      business_id: curr.business?._id.toString() ?? " - ",
      business_name: curr.business?.name ?? " - ",
      outlets: [
        {
          outlet_id: curr.outlet?._id.toString() ?? " - ",
          outlet_name: curr.outlet?.name ?? "-",
          licenses: [
            {
              license_device_id: curr._id.toString(),
              label: curr.license_label,
              price: detail.price,
              prev_expired,
              next_expired,
              pos_id: curr.pos_id?.name ?? " - ",
              total_devices_paid: 1,
            },
          ],
        },
      ],
    };
  };

  const detailBillingFormat = (detail) => {
    const taxes = (detail.tax / 100) * detail.sub_total;
    const dayExpiry = detail.priceLevel?.expiryDay ?? detail.license_duration;

    detail.total_details = [
      {
        label: "Sub Total",
        value: detail.sub_total || "",
      },
      // {
      //   label: "Diskon/Promo", //TODO : dipakek kalau sudah menerapkan promo / diskon
      //   value: "-",
      // },
      {
        label: `PPN ${detail.tax}%`,
        value: taxes || "",
      },
      {
        label: "Total",
        value: detail.grandTotal,
      },
    ];

    const userData = {
      id: detail.user._id.toString(),
      email: detail.user.email,
      fullname: detail.user.fullname,
      phone: detail.user.phone,
    };

    // detail.devices
    const new_data = detail.devices.reduce((prev, curr) => {
      let prev_expired = new Date(curr.expired);
      let next_expired = curr.expired;

      const findBisnisIndex = prev.findIndex(
        (bisnis) => bisnis.business_id === curr.business?._id.toString() ?? ""
      );

      prev_expired = new Date(
        prev_expired.setDate(prev_expired.getDate() - dayExpiry)
      );

      if (findBisnisIndex != -1) {
        const findOutletId = prev[findBisnisIndex].outlets.findIndex(
          (outlet) => outlet.outlet_id === curr.outlet._id.toString()
        );

        if (findOutletId != -1) {
          prev[findBisnisIndex].outlets[findOutletId].licenses.push({
            license_device_id: curr._id.toString(),
            label: curr.license_label ?? detail.license_name,
            price: detail?.priceLevel?.price ?? 0,
            prev_expired,
            next_expired,
            pos_id: curr.pos_id.name,
            total_devices_paid: 1,
          });
          return prev;
        }

        prev[findBisnisIndex].outlets.push({
          outlet_id: curr.outlet._id.toString(),
          outlet_name: curr.outlet.name,
          licenses: [
            {
              license_device_id: curr._id.toString(),
              label: curr.license_label ?? detail.license_name,
              price: detail?.priceLevel?.price ?? 0,
              prev_expired,
              next_expired,
              pos_id: curr.pos_id.name,
            },
          ],
        });

        return prev;
      }

      const unuseLicense = prev.findIndex(
        (bisnis) => bisnis.business_id === " - "
      );

      if (unuseLicense != -1) {
        prev[unuseLicense].outlets[0].licenses.push({
          license_device_id: curr._id.toString(),
          label: curr.license_label ?? detail.license_name,
          price: detail.price,
          prev_expired,
          next_expired,
          pos_id: curr.pos_id?.name ?? " - ",
          total_devices_paid: 1,
        });

        return prev;
      }

      prev = [
        ...prev,
        deviceResultBuilder(curr, detail, prev_expired, next_expired),
      ];

      return prev;
    }, []);

    return {
      business_plan_price_label: detail.priceLevel?.name || "",
      grand_total: detail?.grandTotal || 0,
      id: detail._id.toString(),
      invoice_number: detail.invoiceNumber,
      business_plan_label: detail.master_license?.name ?? detail.license_name,
      business_plan_price: detail.priceLevel?.price || "",
      status: detail.status,
      payment_date: detail.updatedAt,
      payment_src: "CASH",
      payment_url: detail?.xendit_invoice_url || "",
      devices: new_data,
      total_details: detail.total_details,
      user: userData,
    };
  };

  const extendLicenseDevices = (paymentLicense) => {
    const { data } = payload;
    const expiryDay = data.price_level?.expiryDay ?? data.duration;
    const devices = data.device_list;
    const detailDevicesExpired = [];

    const ress = devices.map((item) => {
      let oldDate = new Date(item.expired);
      // if expired, set current date
      if (item.expired <= new Date().getTime()) {
        oldDate = new Date();
      }
      const newExpired = new Date(
        oldDate.setDate(oldDate.getDate() + parseInt(expiryDay))
      );

      detailDevicesExpired.push({
        devices: item._id,
        prevExpired: new Date(item.expired),
        newExpired,
      });

      return {
        updateOne: {
          filter: {
            _id: item._id,
          },
          update: {
            $set: {
              expired: newExpired,
              payment: paymentLicense._id,
            },
          },
        },
      };
    });

    paymentLicense.detailDevicesExpired = detailDevicesExpired;
    return ress;
  };

  const reConstructData = (paymentLicense, invoice) => {
    invoice = EJSON.parse(invoice.body.text());

    paymentLicense.xendit_id = invoice.id.toString();
    paymentLicense.xendit_status = invoice.status;
    paymentLicense.xendit_expiry_date = new Date(invoice.expiry_date);
    paymentLicense.xendit_invoice_url = invoice.invoice_url;

    return paymentLicense;
  };

  const createInvoice = async (paymentLicense) => {
    const { data } = payload;
    const BO_URL = data?.local
      ? context.environment.values.LOCAL_REDIRECT
      : context.environment.values.BO_BASE_URL;
    const success_redirect_url =
      BO_URL + context.environment.values.XENDIT_REDIRECT_SUCCESS;
    const failure_redirect_url =
      BO_URL + context.environment.values.XENDIT_REDIRECT_FAILURE;
    const url = context.environment.values.XENDIT_INVOICE_URL;
    const privateKey = context.environment.values.XENDIT_PRIVATE_KEY;

    const bodyInvoice = {
      external_id: paymentLicense.invoiceNumber,
      amount: paymentLicense.grandTotal,
      // TODO : ganti description dengan JSON stringify { env, action, extend, admin }
      description: JSON.stringify(data.processType), //register or extend
      success_redirect_url,
      failure_redirect_url,
      invoice_duration:
        (paymentLicense.dueDate.getTime() -
          paymentLicense.createdAt.getTime()) /
        1000,
    };

    if (data?.reinitiate) {
      bodyInvoice.success_redirect_url =
        success_redirect_url + "&reinitiate=true";
      bodyInvoice.failure_redirect_url =
        failure_redirect_url + "&reinitiate=true";
    }

    const postinvoice = await context.http.post({
      url: url,
      headers: {
        "Content-Type": ["application/json"],
        Accept: ["application/json"],
        Authorization: [`Basic ${BSON.Binary.fromText(privateKey).toBase64()}`],
      },
      body: JSON.stringify(bodyInvoice),
    });

    return postinvoice;
  };

  const subscribeValidation = async () => {
    await valid.hasPermission(["bo_account_settings"]);
    valid.isObjValid(payload.data, "business_plan_id", "E20163BE", true);
  };

  const adminSubscribeValidation = async () => {
    valid.isObjValid(payload.data, "license_id", "E20148BE", true);
    if (payload.data?.license_devices) {
      valid.isObjValid(payload.data, "payment_media_id", "E20162BE", true);
    }
  };

  const getDevicesTotal = async (type) => {
    const { data } = payload;

    data.processType = {
      env: context.environment.tag,
      action: "payment",
      extend: false,
      admin: false,
      add_license: false,
    };
    if (data?.license_devices?.length > 0) {
      ENV !== "production"
        ? (data.processType.extend = true)
        : (data.processType = "Extend subscription of email ");
      data.total_device = data.license_devices.length;
      data.license_devices = data.license_devices.map((device) =>
        BSON.ObjectId(device.toString())
      );
    }

    if (!data.license_devices) {
      const descSubs = {
        ADMIN_SUBSCRIBE: "Admin Register new account with email ",
        ADMIN_ADD_LIENSE: "Admin Add license with email ",
        BO_SUBSCRIBE: "Register new account with email ",
      };
      let typeSubs;
      switch (type) {
        case "ADMIN_SUBSCRIBE":
          typeSubs = descSubs.ADMIN_SUBSCRIBE;
          break;
        case "ADMIN_ADD_LIENSE":
          typeSubs = descSubs.ADMIN_ADD_LIENSE;
          data.processType.add_license = true;
          break;

        default:
          typeSubs = descSubs.BO_SUBSCRIBE;
          break;
      }
      ENV !== "production"
        ? (data.processType.admin = type == "ADMIN_SUBSCRIBE" ? true : false)
        : (data.processType = typeSubs);
      data.license_devices = [];
    }
  };

  const prepareDataToSave = async (type = "") => {
    const { data } = payload;
    // get price level & discount
    await dbGetPriceLevel();
    // get devices and total
    await getDevicesTotal(type);
    // kalkulasi total payment
    getTotalPayment();
    // generate invoice number
    data.invoice_number = await intRegisterOrExtend.generateInvoice();
    //get client info
    await dbGetClient();
    //get payment media id (name: other)
    await dbGetPaymentMedia();

    const exp_date = context.values.get("XENDIT_EXPIRATION");

    return {
      __v: 0,
      _id: new BSON.ObjectId(),
      _partition: "",
      active: true,
      createdAt: new Date(),
      createdBy: BSON.ObjectId(user_id),
      updatedAt: new Date(),
      updatedBy: BSON.ObjectId(user_id),
      license_duration: parseInt(data.license_duration),
      license_name: data.license_name,
      license: type.includes("ADMIN")
        ? BSON.ObjectId(data.license_id)
        : license || BSON.ObjectId(data.license_id),
      payment_media_id: data.payment_media_id,
      user_id: license ? BSON.ObjectId(user_id) : data.client_id,
      dueDate: new Date(
        new Date().setDate(new Date().getDate() + exp_date.license.value)
      ),
      status: data.payment_media_name === "other" ? "pending" : "paid",
      type: "subscribed",
      operator: license ? "public" : "internal",
      masterLicenseId: data?.business_plan_id
        ? BSON.ObjectId(data?.business_plan_id)
        : null,
      master_license_price_level: data?.price_level?._id ?? null,
      master_license_discount: data?.master_discount?._id ?? null,
      price: parseFloat(data.price),
      grandTotal: parseFloat(data.total_payment),
      sub_total: parseFloat(data.sub_total),
      tax: parseFloat(data?.price_level?.tax ?? data.tax),
      totalDevicesPaid:
        data?.license_devices?.length > 0
          ? parseInt(0)
          : parseInt(data.total_device),
      invoiceNumber: data.invoice_number,
      devices: data.license_devices,
    };
  };

  const getTotalPayment = () => {
    const { data } = payload;

    // perhitungan payment harga total sudah include tax jadi , perhitungannya di hitung dari total , subtotal, tax
    data.price = data?.price_level?.price ?? data.total;
    data.total_payment =
      data.price === 0
        ? paerseFloat(0)
        : data.price_level
        ? data?.price_level?.price * parseFloat(data.total_device)
        : data.total;
    data.sub_total =
      data.price === 0
        ? paerseFloat(0)
        : data.total_payment / (data?.price_level?.tax ?? data.tax / 100 + 1);
    data.taxes =
      data.price === 0 ? paerseFloat(0) : data.total_payment - data.sub_total;
  };

  const formatReturn = (list_user_license) => {
    return list_user_license.map((v) => {
      return {
        id: v._id.toString(),
        outlet_id: v.outlet ? v.outlet._id.toString() : "",
        outlet_name: v.outlet ? v.outlet.name.toString() : "",
        business_id: v.business ? v.business._id.toString() : "",
        business_name: v.business ? v.business.name.toString() : "",
        pos_id: v.pos_id ? v.pos_id._id.toString() : "",
        pos_name: v.pos_id ? v.pos_id.name : "",
        expired: v.expired,
        license: v.license.toString(),
        license_label: v.license_label,
        license_master_id: v.master_license._id.toString(),
        license_master_name: v.master_license.name,
      };
    });
  };

  const listValidationAndFilter = async () => {
    await valid.hasPermission(["bo_account_settings"]);

    let { filter } = payload;

    filter.license = license;
  };

  //--------------- DB function ----------------
  const dbGetDetailBilling = async (filter) => {
    return await db
      .collection(user_license_payment)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: "user",
            let: { license: ["$license"] },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$license", "$$license"] },
                  type: "owner",
                },
              },
              { $project: { _id: 1, email: 1, fullname: 1, phone: 1 } },
            ],
            as: "user",
          },
        },
        {
          $unwind: {
            path: "$user",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "master_license_price_level",
            localField: "master_license_price_level",
            foreignField: "_id",
            as: "priceLevel",
          },
        },
        {
          $unwind: {
            path: "$priceLevel",
            preserveNullAndEmptyArrays: true,
          },
        },
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
                  pos_id: { _id: 1, name: 1 },
                  outlet: { _id: 1, name: 1 },
                  business: { _id: 1, name: 1 },
                },
              },
            ],
            as: "devices",
          },
        },
        {
          $sort: {
            updatedAt: -1,
          },
        },
        {
          $project: {
            invoiceNumber: 1,
            sub_total: 1,
            tax: 1,
            status: 1,
            price: 1,
            grandTotal: 1,
            updatedAt: 1,
            xendit_invoice_url: 1,
            license_duration: 1,
            license_name: 1,
            user: {
              _id: 1,
              email: 1,
              fullname: 1,
              phone: 1,
            },
            priceLevel: {
              name: 1,
              price: 1,
              expiryDay: 1,
            },
            master_license: {
              _id: 1,
              name: 1,
            },
            devices: {
              _id: 1,
              license_label: 1,
              expired: 1,
              pos_id: {
                _id: 1,
                name: 1,
              },
              outlet: {
                _id: 1,
                name: 1,
              },
              business: {
                _id: 1,
                name: 1,
              },
            },
          },
        },
      ])
      .toArray();
  };

  const dbUpdateLicenseDevices = async (devices) => {
    try {
      await db.collection(user_license_device).bulkWrite(devices);
    } catch (e) {
      throw new Error(e);
    }
  };

  const dbListUserLicenseDevice = async () => {
    const { filter } = payload;
    return await db
      .collection(user_license_device)
      .aggregate([
        {
          $match: {
            ...filter,
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
            from: user_business,
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
          $lookup: {
            from: "user_license_payment",
            localField: "payment",
            foreignField: "_id",
            as: "payment",
          },
        },
        {
          $unwind: "$payment",
        },
        {
          $lookup: {
            from: "master_license",
            localField: "payment.masterLicenseId",
            foreignField: "_id",
            as: "master_license",
          },
        },
        {
          $unwind: "$master_license",
        },
        {
          $project: {
            _id: 1,
            expired: 1,
            license: 1,
            license_label: 1,
            license_uuid: 1,
            outlet: { _id: 1, name: 1 },
            business: {
              _id: 1,
              name: 1,
            },
            master_license: { _id: 1, name: 1 },
            pos_id: {
              _id: 1,
              name: 1,
            },
            lowerLabel: { $toLower: "$license_label" },
          },
        },
        { $sort: { lowerLabel: 1 } },
      ])
      .toArray();
  };

  const dbGetDevicesList = async () => {
    const { data } = payload;

    const license_device = await db
      .collection(user_license_device)
      .find(
        {
          _id: {
            $in: data.license_devices.map((device) =>
              BSON.ObjectId(device.toString())
            ),
          },
        },
        { _id: 1, expired: 1 }
      )
      .toArray();

    if (license_device.length == 0) {
      throw new Error("E30082BE");
    }

    data.device_list = license_device;
  };

  const dbGetPaymentMedia = async () => {
    const { data } = payload;
    const findBy = data.payment_media_id ? "_id" : "name";
    const value = data.payment_media_id
      ? BSON.ObjectId(data.payment_media_id)
      : "other";

    const payment_media = await db.collection(license_payment_media).findOne(
      {
        [findBy]: value,
      },
      { _id: 1, name: 1 }
    );

    if (!payment_media) throw new Error("E30073BE");

    data.payment_media_id = payment_media._id;
    data.payment_media_name = payment_media.name;
  };

  const dbGetPriceLevel = async () => {
    const { data } = payload;

    if (data?.duration >= 1 && data?.total > -1) {
      data.license_name = "custom";
      data.license_duration = data.duration;
      data.price_level = null;
      data.master_discount = null;
      return;
    }

    let filterPrice = {
      $expr: {
        $in: ["$_id", "$$priceLevel"],
      },
      default: true,
    };
    let filterDiscount = {
      $expr: {
        $in: ["$_id", "$$discount"],
      },
      default: true,
    };

    if (data?.master_license_price_level && data?.master_license_discount) {
      filterPrice = {
        $expr: {
          $and: [
            {
              $eq: ["$_id", BSON.ObjectId(data.master_license_price_level)],
            },
            { $in: ["$_id", "$$priceLevel"] },
          ],
        },
        active: true,
      };
      filterDiscount = {
        $expr: {
          $and: [
            {
              $eq: ["$_id", BSON.ObjectId(data.master_license_discount)],
            },
            { $in: ["$_id", "$$discount"] },
          ],
        },
        active: true,
      };
    }

    const [license_data] = await db
      .collection(master_license)
      .aggregate([
        {
          $match: { _id: BSON.ObjectId(data.business_plan_id), active: true },
        },
        {
          $lookup: {
            from: "master_license_price_level",
            let: { priceLevel: { $ifNull: ["$priceLevel", []] } },
            pipeline: [
              {
                $match: { ...filterPrice },
              },
            ],
            as: "master_license_price_level",
          },
        },
        {
          $lookup: {
            from: "master_license_discount",
            let: { discount: { $ifNull: ["$discount", []] } },
            pipeline: [
              {
                $match: { ...filterDiscount },
              },
            ],
            as: "discounts",
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            master_license_price_level: {
              _id: 1,
              price: 1,
              expiryDay: 1,
              tax: 1,
            },
            discounts: { _id: 1 },
          },
        },
      ])
      .toArray();

    if (!license_data) throw new Error("E30125BE");

    if (license_data.master_license_price_level.length <= 0)
      throw new Error("E30091BE");

    if (license_data.discounts.length <= 0) throw new Error("E30088BE");

    data.price_level = license_data.master_license_price_level[0];
    data.license_duration =
      license_data.master_license_price_level[0].expiryDay;
    data.license_name = license_data.name;
    data.master_discount = license_data.discounts[0];
  };

  const dbGetClient = async () => {
    const { data } = payload;
    const client = await db.collection(user).findOne(
      {
        license: license || BSON.ObjectId(data.license_id),
      },
      { _id: 1, email: 1 }
    );

    if (!client) throw new Error("E30101BE");

    if (ENV === "production") {
      data.processType = data.processType + client.email;
    }

    data.client_id = client._id;
  };

  const dbCreatePaymentLicense = async (paymentLicense) => {
    const payment_license = await db
      .collection(user_license_payment)
      .insertOne(paymentLicense);
    return payment_license.insertedId.toString();
  };

  return Object.freeze({ LIST, SUBSCRIBE, ADMIN_SUBSCRIBE });
};
