// This function is the webhook's request handler.
exports = async (payload) => {
  try {
    const handler = mainHandler(payload);
    const payment_license = await handler.dbGetLicensePayment();
    const license_devices = await handler.generateLicenseDevices(
      payment_license
    );

    await handler.updateLicensePayment(license_devices, payment_license);
    await handler.formatingAndSendEmail(payment_license.license);
    return true;
  } catch (e) {
    const handler = mainHandler(payload);
    const user = await handler.getUserAndId();
    console.log(e, "error");
    // NOTES siapa yang konsume error
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "whCallbackXendit",
      user
    );
  }
};
/*
exports({
  body: BSON.Binary.fromText(
    JSON.stringify({
      id: "619f0ad9018d1572bea71b53",
      user_id: "606c04cbb3766d12ec048178",
      external_id: "INV2100000001",
      is_high: false,
      status: "PAID",
      merchant_name: "PT Wisanin Artha Jaya",
      amount: 400000,
      created: "2021-11-25T04:02:34.485Z",
      updated: "2021-11-25T04:08:02.526Z",
      paid_amount: 400000,
      fees_paid_amount: 6600,
      payment_method: "EWALLET",
      adjusted_received_amount: 393400,
      ewallet_type: "DANA",
      currency: "IDR",
      paid_at: "2021-11-25T04:07:35.742Z",
      payment_channel: "DANA",
    })
  ),
})
*/

/*
   exports({
  body: BSON.Binary.fromText(
    JSON.stringify( {
        "id": "63ca4abc0d8fc0840bee2fb1",
        "amount": 400000,
        "status": "PAID",
        "created": "2022-07-26T06:34:20.341Z",
        "is_high": false,
        "paid_at": "2022-07-26T06:34:33.436Z",
        "updated": "2022-07-26T06:34:33.555Z",
        "user_id": "619f5915ff805ffa59862bfe",
        "currency": "IDR",
        "bank_code": "BCA",
        "description": "subscription of email irfanfandi@gmail.com",
        "external_id": "INV2200000001",
        "paid_amount": 400000,
        "merchant_name": "PT Wisanin Artha Jaya",
        "initial_amount": 400000,
        "payment_method": "BANK_TRANSFER",
        "payment_channel": "BCA",
        "payment_destination": "1076657571551"
    })
  ),
})
*/

const mainHandler = (payload) => {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const email_server = context.environment.values.SETUP_EMAIL_SERVER;
  const valid = context.functions.execute("intValidation", payload.data);
  const intRegisterOrExtend = context.functions.execute("intRegisterOrExtend");
  const db = mongodb.db(context.values.get("DB_NAME"));
  const body = EJSON.parse(payload.body.text());
  const ENV = context.environment.tag;
  const detailDevicesExpired = [];

  const {
    user_license_payment,
    user_license_device,
    user,
    pos_ids,
    outlet: outletCollection,
  } = context.values.get("COLLECTION_NAMES");

  const generateLicenseDevices = async (paymentLicense) => {
    const minimalQty = paymentLicense.master_discount?.minQty ?? 0;
    const totalDevicesPaid = paymentLicense.totalDevicesPaid;

    if (paymentLicense.status == "paid") throw new Error("E30125BE");

    // saat subscribe, cek minqty tidak boleh lebih besar dari total device paid
    if (paymentLicense.devices?.length < 1 && minimalQty > totalDevicesPaid) {
      throw new Error(
        `${paymentLicense.invoiceNumber} minimal ${minimalQty} device`
      );
    }

    if (paymentLicense.devices?.length > 0) {
      // jika extends
      const licenseDevices = extendLicenseDevicesData(paymentLicense);
      // update license devices
      return dbUpdateLicenseDevices(licenseDevices);
    }
    return generateLicenseSubscribe(paymentLicense);
  };

  const generateLicenseSubscribe = async (paymentLicense) => {
    const { description } = body;

    // construct data license devices
    const licenseDevices = await prepareDataLicenseDevice(paymentLicense);
    // insert license device to database
    const result = await createLicenseDevices(licenseDevices);
    // update detailDevice
    updateDetailExpired(result, paymentLicense);

    // jika create new account maka call createInstallPosidNewAccount
    if (ENV !== "production") {
      const desc = JSON.parse(description);

      if (desc.admin && !desc.add_license) {
        await createInstallPosidNewAccount(paymentLicense);
      } else {
        await createInstallPosid(paymentLicense);
      }
    }

    if (ENV === "production") {
      description.includes("Admin Register")
        ? await createInstallPosidNewAccount(paymentLicense)
        : await createInstallPosid(paymentLicense);
    }

    return result;
  };

  const createInstallPosidNewAccount = async (paymentLicense) => {
    const totalDevicesPaid = paymentLicense.totalDevicesPaid;
    const posId = await dbFetchPosIds(paymentLicense);
    const newLicenseDevices = await dbFetchLicenseDevice(paymentLicense);
    const dataUpdate = {
      _partition: posId.outlet.toString(),
      user_id: BSON.ObjectId(paymentLicense?.user_id.toString()),
      license_device_id: BSON.ObjectId(newLicenseDevices[0]?._id.toString()),
    };
    if (totalDevicesPaid > 1) dataUpdate.name = "Kasir 1";

    await dbUpdatePosIds(
      { _id: BSON.ObjectId(posId._id.toString()) },
      dataUpdate
    );

    posId.license_device_id = dataUpdate.license_device_id;
    let listPosIds = [posId];
    // jika totalDevicesPaid lebih dari 1, process create new posId
    if (totalDevicesPaid > 1) {
      const newDataPosIds = await dbCreatePosIds(
        posId,
        paymentLicense,
        totalDevicesPaid,
        newLicenseDevices
      );
      await dbUpdateOutlet(newDataPosIds, posId.outlet, paymentLicense.license);
      listPosIds = listPosIds.concat(newDataPosIds);
    }

    await dbUpdatePosIdLicenseDevice(listPosIds);
  };

  const createInstallPosid = async (paymentLicense) => {
    const totalDevicesPaid = paymentLicense.totalDevicesPaid;
    const totalPosIdAlready = await dbGetCountPosId(paymentLicense);
    const posId = await dbFetchPosIds(paymentLicense);
    const newLicenseDevices = await dbFetchLicenseDevice(paymentLicense);

    if (newLicenseDevices.length < 0) return;

    const newDataPosIds = await dbCreatePosIds(
      posId,
      paymentLicense,
      totalDevicesPaid,
      newLicenseDevices,
      totalPosIdAlready
    );
    // insert posid to outlet
    await dbUpdateOutlet(newDataPosIds, posId.outlet, paymentLicense.license);

    await dbUpdatePosIdLicenseDevice(newDataPosIds);
  };

  const updateLicensePayment = async (license_devices, payment_license) => {
    let dataUpdate = {
      xendit_status: body.status,
      updatedAt: new Date(),
      detailDevicesExpired: detailDevicesExpired,
    };

    body.status == "PAID"
      ? (dataUpdate.status = "paid")
      : (dataUpdate.status = "cancel");

    dataUpdate.xendit_channel_code = body.payment_channel;

    if (license_devices?.insertedIds?.length > 0) {
      dataUpdate.devices = license_devices.insertedIds;
      if (body.status == "PAID") {
        await dbUpdateStatusUser(
          true,
          payment_license.user_id,
          payment_license.license
        );
      } else {
        await dbUpdateStatusUser(
          false,
          payment_license.user_id,
          payment_license.license
        );
      }
    }

    if (payment_license?.devices?.length > 0 && body.status == "PAID") {
      dataUpdate.totalDevicesPaid = payment_license.devices.length;
    }
    await dbUpdateLicensePayment(payment_license, dataUpdate);
  };

  const updateDetailExpired = (devices, paymentLicense) => {
    const expiryDay = paymentLicense.price_level?.expiryDay ?? paymentLicense.license_duration;

    console.log(expiryDay, "expiryDay");

    devices.insertedIds.map((id) => {
      let newExpired = new Date();
      newExpired = new Date(
        newExpired.setDate(newExpired.getDate() + expiryDay)
      );

      detailDevicesExpired.push({
        devices: id,
        prevExpired: null,
        newExpired,
      });
    });
  };

  const extendLicenseDevicesData = (paymentLicense) => {
    const expiryDay = paymentLicense.price_level?.expiryDay ?? paymentLicense.license_duration;
    const devices = paymentLicense.devices;

    const ress = devices.map((eachdevice) => {
      let oldDate = new Date(eachdevice.expired);
      // jika tanggal exipred kurang dari current date
      // maka tgl expired baru = currentDate + jumlah hari perpanjang
      if (oldDate < new Date()) {
        oldDate = new Date();
      }

      const newExpired = new Date(
        oldDate.setDate(oldDate.getDate() + expiryDay)
      );

      detailDevicesExpired.push({
        devices: eachdevice._id,
        prevExpired: new Date(eachdevice.expired),
        newExpired,
      });

      return {
        updateOne: {
          filter: {
            _id: eachdevice._id,
            license: paymentLicense.license,
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
  };

  const createLicenseDevices = async (licenseDevices) => {
    return await db.collection(user_license_device).insertMany(licenseDevices);
  };

  const prepareDataLicenseDevice = async (paymentLicense) => {
    let lastLicenseDevice = await intRegisterOrExtend.getLastLicense({
      license: BSON.ObjectId(paymentLicense.license.toString()),
    });
    const expiryDay = paymentLicense.price_level?.expiryDay ?? paymentLicense.license_duration;
    const foundClient = paymentLicense.user_id;
    const foundUser = paymentLicense.createdBy;
    const license = paymentLicense.license;
    const totalDevicesPaid = paymentLicense.totalDevicesPaid;
    const expiredDate = new Date(
      new Date().setDate(new Date().getDate() + expiryDay)
    );
    const licenseDevices = Array(totalDevicesPaid)
      .fill()
      .map(() => {
        lastLicenseDevice = lastLicenseDevice + 1;
        return {
          _id: new BSON.ObjectId(),
          _partition: "",
          __v: 0,
          feature: [],
          addOns: [],
          code: "",
          expired: expiredDate,
          payment: paymentLicense._id,
          active: true,
          user_id: foundUser !== foundClient ? foundClient : foundUser,
          license: license,
          license_uuid: valid.generateUUID(),
          license_label: `LICENSE ${lastLicenseDevice}`,
          createdAt: new Date(),
          createdBy: foundUser,
          updatedAt: new Date(),
          updatedBy: foundUser,
        };
      });
    return licenseDevices;
  };

  const formatingAndSendEmail = async (license) => {
    const { description } = body;
    let path = `${email_server}/extend`;

    if (ENV !== "production") {
      const desc = JSON.parse(description);

      if (desc.admin) {
        path = `${email_server}/subscribe`;
      }
    }

    if (ENV === "production") {
      path =
        description.includes("Admin Register") ||
          description.includes("Admin Add license")
          ? `${email_server}/subscribe`
          : `${email_server}/extend`;
    }

    const detailBill = await dbGetDetailBilling(license);

    const formatData = detailBillingFormat(detailBill[0]);

    const emailPayload = {
      to: formatData.user.email,
      from: "Grande POS <cs@grandepos.io>",
      subject: `Detail subscription ${formatData.invoice_number}`,
      path,
      body: {
        key: formatData.id,
        data: formatData,
      },
    };

    return context.functions.execute("intSendEmail", emailPayload);
  };

  const detailBillingFormat = (detail) => {
    const taxes = (detail.tax / 100) * detail.sub_total;
    const dayExpiry = detail.priceLevel?.expiryDay ?? detail?.license_duration;

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
      let next_expired = new Date(curr.expired);

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
            label: curr.license_label,
            // price: detail.priceLevel.price, price sementara tidak dikirim handle custom price via admin case device lebih dari satu mau di tampilkan price ? dari total
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
              label: curr.license_label,
              // price: detail.priceLevel.price,
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
          label: curr.license_label,
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

    const bank_codes = context.values.get("CODE_BANKS");
    const body_code = body.bank_code ? body.bank_code : body.ewallet_type;
    const payment_source = bank_codes.find(({ code }) => code === body_code);

    return {
      type: "subscribe",
      business_plan_price_label: detail.priceLevel?.name || "",
      grand_total: detail?.grandTotal || 0,
      id: detail._id.toString(),
      invoice_number: detail.invoiceNumber,
      business_plan_label: detail.master_license?.name || "",
      business_plan_price: detail.priceLevel?.price || "",
      status: detail.status,
      payment_date: detail.updatedAt,
      payment_src: payment_source.name,
      payment_url: detail?.xendit_invoice_url || "",
      devices: new_data,
      total_details: detail.total_details,
      user: userData,
    };
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

  //--------------- DB function ----------------
  const dbUpdateLicenseDevices = async (devices) => {
    return db.collection(user_license_device).bulkWrite(devices);
  };

  const dbUpdateLicensePayment = async ({ license }, dataUpdate) => {
    await db.collection(user_license_payment).updateMany(
      { xendit_id: body.id.toString(), license },
      {
        $set: dataUpdate,
        $inc: { __v: 1 },
      }
    );
  };

  const dbUpdateStatusUser = async (status, userId, license) => {
    return db.collection(user).bulkWrite([
      {
        updateOne: {
          filter: {
            _id: userId,
            license,
          },
          update: {
            $set: {
              active: status,
              updatedAt: new Date(),
            },
            $inc: { __v: 1 },
          },
        },
      },
    ]);
  };

  const dbGetDetailBilling = async (license) => {
    const filter = {
      xendit_id: body.id.toString(),
      license,
    };

    return db
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

  const dbGetLicensePayment = async () => {
    const payment = await db
      .collection(user_license_payment)
      .aggregate([
        {
          $match: {
            xendit_id: body.id.toString(),
          },
        },
        {
          $project: {
            _id: 1,
            license: 1,
            license_duration: 1,
            totalDevicesPaid: 1,
            status: 1,
            master_license_price_level: 1,
            master_license_discount: 1,
            devices: 1,
            user_id: 1,
            createdBy: 1,
          },
        },
        {
          $lookup: {
            from: "master_license_price_level",
            localField: "master_license_price_level",
            foreignField: "_id",
            as: "price_level",
          },
        },
        {
          $unwind: {
            path: "$price_level",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "master_license_discount",
            localField: "master_license_discount",
            foreignField: "_id",
            as: "master_discount",
          },
        },
        {
          $unwind: {
            path: "$master_discount",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "user_license_device",
            localField: "devices",
            foreignField: "_id",
            as: "devices",
          },
        },
        {
          $project: {
            _id: 1,
            license: 1,
            license_duration: 1,
            totalDevicesPaid: 1,
            status: 1,
            devices: {
              _id: 1,
              expired: 1,
            },
            invoiceNumber: 1,
            master_discount: {
              minQty: 1,
            },
            price_level: {
              expiryDay: 1,
            },
            createdBy: 1,
            user_id: 1,
          },
        },
      ])
      .toArray();

    if (payment.length == 0) {
      throw new Error("E30126BE");
    }

    return payment[0];
  };

  const dbFetchPosIds = async ({ license }) => {
    return db
      .collection(pos_ids)
      .findOne(
        { license: BSON.ObjectId(license.toString()) },
        { _id: 1, outlet: 1, license_device_id: 1 }
      );
  };

  const dbGetCountPosId = async ({ license }) => {
    return db
      .collection(pos_ids)
      .count({ license: BSON.ObjectId(license.toString()) });
  };

  const dbFetchLicenseDevice = async ({ user_id }) => {
    return db
      .collection(user_license_device)
      .find({
        user_id: BSON.ObjectId(user_id.toString()),
        pos_id: { $exists: false },
      })
      .toArray();
  };

  const dbUpdatePosIds = async (filter, dataUpdate) => {
    return db.collection(pos_ids).updateOne(filter, { $set: dataUpdate });
  };

  const dbCreatePosIds = async (
    { outlet },
    { user_id, license },
    deviceQty,
    LicenseDevices,
    totalPosIdAlready = 0
  ) => {
    let idx = totalPosIdAlready > 0 ? 0 : 1;
    let counterName = totalPosIdAlready || 1;

    // jika totalPosIdAlready > 0 atau subscribe via BO maka total yg dibuat sesuai payload
    const ExdeviceQty = totalPosIdAlready > 0 ? deviceQty : deviceQty - 1;
    const dataPosIds = [];
    const userid = BSON.ObjectId(user_id.toString());

    for (let i = 0; i < ExdeviceQty; i++) {
      counterName = counterName + 1;
      dataPosIds.push({
        __v: 0,
        _id: new BSON.ObjectId(),
        _partition: outlet.toString(),
        active: true,
        outlet: BSON.ObjectId(outlet.toString()),
        license: BSON.ObjectId(license.toString()),
        user_id: userid,
        name: `Kasir ${counterName}`,
        createdAt: new Date(),
        createdBy: userid,
        updatedAt: new Date(),
        updatedBy: userid,
        license_device_id: LicenseDevices[idx]._id,
      });
      idx++;
    }
    await db.collection(pos_ids).insertMany(dataPosIds);
    return dataPosIds;
  };

  const dbUpdatePosIdLicenseDevice = async (listPosIds) => {
    const updateData = listPosIds.map((obj) => {
      const { license_device_id, _id: pos_id, outlet } = obj;
      return {
        updateOne: {
          filter: {
            _id: license_device_id,
          },
          update: {
            $set: { pos_id, outlet },
          },
        },
      };
    });

    return db.collection(user_license_device).bulkWrite(updateData);
  };

  const dbUpdateOutlet = async (posIdData, outlet, license) => {
    const posIds = posIdData.map((x) => x._id);

    return db.collection(outletCollection).updateOne(
      {
        _id: BSON.ObjectId(outlet.toString()),
        license: license,
      },
      {
        $push: { pos: { $each: posIds } },
      }
    );
  };

  const getUserAndId = async () => {
    try {
      if (!body?.user_id) {
        return "-";
      }

      const user = await db.collection(user).findOne(
        {
          _id: body.user_id,
        },
        { fullname: 1 }
      );

      return user ? `${user.fullname} | ${user._id?.toString()}` : "-";
    } catch (e) {
      return "-";
    }
  };

  return Object.freeze({
    dbGetLicensePayment,
    updateLicensePayment,
    generateLicenseDevices,
    formatingAndSendEmail,
    getUserAndId,
  });
};
