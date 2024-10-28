/*
  REGISTER CUSTOM PRICE
 {
  "method": "REGISTER",
  "data": {},
  "filter": {},
  "body": {
    "email": "fahmi@shark.tech",
    "password": "fahmi123",
    "fullname": "Fahmi Admin",
    "phone": "+62817827917289",
    "pin": "1111",
    "business": {
      "business_category_id": "65656561213861cb7024bb75",
      "business_name": "Kasual",
      "outlet_name": "Cicang",
      "country_id": "65656562213861cb7024bce3",
      "province_id": "65656562213861cb7024c5cd",
      "city_id": "65656562213861cb7024be65",
      "subdistrict_id": "66d6b96b23fc41d1752d9db2",
      "address": "kajsdkajdl",
      "postal_code": "-"
    },
    "license_payment_media": "65656561213861cb7024bb8a",
    "device_qty": 1,
    "total": 200000,
    "duration":30,
    "tax": 11
  }
}
*/

/*
  exports({
  method:"REGISTER",
  body :
  {
      "email":"irfanfandi@gmail.com",
      "pin":"1111",
      "password": "fandi123",
      "fullname": "fandi",
      "phone": "+6288228455435",
      "business":{
        "business_category_id": "6348c589a37b90d41562f85b",
        "business_name": "Belut Mercon",
        "outlet_name": "Belut Mercon Lamongan",
        "country_id": "634919eea37b90d41577585a",
        "province_id": "634919eea37b90d415776181",
        "city_id": "634919eea37b90d4157758fb",
        "subdistrict_id": "61a880b281ccd418c4e0481",
        "address": "Paciran Lamongan",
        "postal_code": "622647"
      },
      "master_license_id": "6348c589a37b90d41562f84b",
      "license_payment_media":"6348c589a37b90d41562f861",
      "master_license_price_level":"6348c589a37b90d41562f84c",
      "master_license_discount": "6348c589a37b90d41562f84d",
      "device_qty": 4,
      "total": 120000,
      "duration": 360,
      "tax": 10
  }
  })
  */

// exports({
//   "method": "ADD_LICENSE",
//   "data": {},
//   "filter": {},
//   "body": {
//       "duration": 50,
//       "totalDevice": 5,
//       "tax": 10,
//       "customPrice": 123000,
//       "business_plan_id": "",
//       "total_device": "",
//       "total": 123000,
//       "license_id": "66dab7a505b48b913cb43e51",
//       "license_payment_media": "65656561213861cb7024bb8c",
//       "user_id": "66dab7a505b48b913cb43e50",
//       "add_license": true,
//       "device_qty": 5,
//       "outlet_id": "66dab7a505b48b913cb43e8b"
//   }
// })

/*
   exports({
      "method": "ADD_LICENSE",
      "data": {},
      "filter": {},
      "body": {
        "master_license_id": "65656560213861cb7024bb2f",
        "master_license_discount": "65656560213861cb7024bb31",
        "master_license_price_level": "65656560213861cb7024bb30",
        "license_payment_media":"6348c589a37b90d41562f861",
        "device_qty": "2",
        "license_id": "65795f8a2675a2b5b60f4dc5",
        "user_id": "65795f8a2675a2b5b60f4dc4",
        "outlet_id": "659cf8089172ec90a44d98df",
      }
    })
  */

module.exports = async (payload) => {
  try {
    await generalFunction(payload);
    return true;
  } catch (error) {
    return context.functions.execute(
      "handleCatchError",
      error,
      payload,
      "adminRegisterClient"
    );
  }
};

const generalFunction = async (payload) => {
  const { body } = payload;
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();
  const intRegisterOrExtend = context.functions.execute("intRegisterOrExtend");
  const email_server = context.environment.values.SETUP_EMAIL_SERVER;
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");
  const collectionEnums = context.values.get("COLLECTION_ENUMS");
  const ctx_user_id = new BSON.ObjectId(context.user.data.user_id);
  let user_data, newUserLicens;

  // validate license
  const { licensePaymentMedia, license_data, licensePriceLevel } =
    await validateLicense();

  switch (payload.method) {
    case "REGISTER":
      return await registerClient();

    case "ADD_LICENSE":
      return await addLicensePaymentCash();

    default:
      throw new Error("E40001BE");
  }

  async function registerClient() {
    // validate payload
    await validate();

    // insert user data
    user_data = await dbInsertDataUser();
    // // construct data license
    newUserLicense = construcUserLicense();

    // process by type payment
    if (licensePaymentMedia.name.toLowerCase() === "other") {
      return await processPaymentOther();
    }
    return await processPaymentCash();
  }

  async function addLicensePaymentCash() {
    // validate payload
    valid.isRequired(body, "user_id", "E20035BE");
    valid.isRequired(body, "license_id", "E20148BE");
    valid.isRequired(body, "outlet_id", "E20192BE");
    // valid.isRequired(body, "master_license_id", "E20148BE");
    // valid.isRequired(body, "master_license_price_level", "E20148BE");

    // get user data
    user_data = {
      license: BSON.ObjectId(body.license_id.toString()),
      _id: BSON.ObjectId(body.user_id.toString()),
    };
    // get data license
    newUserLicense = { _id: user_data.license };

    return await processAddLicensePaymentCash();
  }

  //--------------- Helper function ----------------
  async function processPaymentOther() {
    await construcLicensePaymentOther();

    await dbInsertUserLicense();
    // get region
    const region = await getRegName();
    // formating data bussiness
    const prepare_data_bussiness = await prepareDataToSave(region);
    // save data bussiness
    await saveDataBusiness(prepare_data_bussiness);
    // creating user credentials
    await createUserCredentials(prepare_data_bussiness.newOutlet._id);

    return true;
  }

  async function processAddLicensePaymentCash() {
    const userLicense = await construcLicense();
    const data = {
      ...userLicense,
    };
    const filterLicensePaymentId = {
      _id: BSON.ObjectId(userLicense.user_license_payment._id.toString()),
    };

    //save data user_license_payment, user_license, user_license_device
    const deviceIds = await dbInsertDataAddLicense(data);

    let detailDevicesExpired = [];
    // TODO: Sebelumnya langsung dapat array dari insertedIds tetapi dapat object dari return mongodb driver
    // Sehingga harus di parse ke araay dulu
    const data_array = Object.values(deviceIds.insertedIds)
    //deviceIds.insertedIds.map((id) => { 
    data_array.map((id) => {
      const user_device = data.user_license_device.find(
        (e) => e._id.toString() === id.toString()
      );

      const obj = {
        devices: id,
        // prevExpired: new Date(),
        newExpired: user_device.expired, // mas yuda minta ini di samakan dengan user_license_device dan jam nya ikut utc +0
      };

      detailDevicesExpired.push(obj);
    });

    // get data bussiness
    await processAddLicenseDevice();
    // update devices license payment
    await dbUpdateLicensePayment(filterLicensePaymentId, {
      detailDevicesExpired,
      devices: data_array,
    });
    // send email
    await formatingAndSendEmail(filterLicensePaymentId);

    return true;
  }

  async function processPaymentCash() {
    const userLicense = await construcLicense();
    const data = {
      ...userLicense,
    };
    const filterLicensePaymentId = {
      _id: BSON.ObjectId(userLicense.user_license_payment._id.toString()),
    };

    //save data user_license_payment, user_license, user_license_device
    const deviceIds = await dbInsertDataLicense(data);

    // get region
    const region = await getRegName();
    // formating data bussiness
    const prepare_data_bussiness = await prepareDataToSave(region);
    // save data bussiness
    const { posId, outletID } = await saveDataBusiness(prepare_data_bussiness);
    // update license berdasarkan total device
    await processUpdateLicenseDevice(posId, outletID);
    // creating user credentials
    await createUserCredentials(prepare_data_bussiness.newOutlet._id);

    // update devices license payment
    let detailDevicesExpired = [];
    const today = new Date();
    deviceIds.insertedIds.map((id) => {
      const user_device = data.user_license_device.find(
        (e) => e._id.toString() === id.toString()
      );

      const obj = {
        devices: id,
        // prevExpired: new Date(),
        newExpired: user_device.expired, // mas yuda minta ini di samakan dengan user_license_device dan jam nya ikut utc +0
      };

      detailDevicesExpired.push(obj);
    });
    await dbUpdateLicensePayment(filterLicensePaymentId, {
      detailDevicesExpired,
      devices: deviceIds.insertedIds,
    });

    // send email
    await formatingAndSendEmail(filterLicensePaymentId);

    return true;
  }

  async function saveDataBusiness(data_business) {
    const {
      newOutlet: { _id: outletID, country: country_id },
    } = data_business;

    const {
      posId: [{ ...posId }],
      bill_design: { _id: billDesignID },
    } = await executeDefaultData(outletID, country_id);

    data_business.newOutlet.pos.push(posId._id);
    data_business.newOutlet._id = posId.outlet;

    await dbInsertACLBusinessAndOutlet(data_business);
    await dbUpdateBillDesign(data_business, billDesignID);

    return { data_business, posId, outletID };
  }

  async function formatingAndSendEmail(filter) {
    const detailBill = await dbGetDetailBilling(filter);
    const formatData = detailBillingFormat(detailBill[0]);

    const emailPayload = {
      to: formatData.user.email,
      from: "Grande POS <cs@grandepos.io>",
      subject: `Detail subscription ${formatData.invoice_number}`,
      path: `${email_server}/subscribe`,
      body: {
        key: formatData.id,
        data: formatData,
      },
    };

    return context.functions.execute("intSendEmail", emailPayload);
  }

  function detailBillingFormat(detail) {
    const taxes = (detail.tax / 100) * detail.sub_total;
    const dayExpiry = detail.priceLevel?.expiryDay ?? detail.license_duration;

    detail.total_details = [
      {
        label: "Sub Total",
        value: detail.sub_total || "",
      },
      {
        label: "Diskon/Promo",
        value: "-",
      },
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

      // const findOnDeviceExp = detail.detailDevicesExpired.find(e => e.devices.toString() === curr._id.toString())

      // console.log(JSON.stringify(findOnDeviceExp))
      // if (findOnDeviceExp) {
      //   prev_expired = findOnDeviceExp.prevExpired
      // }

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
            price: detail.priceLevel?.price ?? 0,
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
              price: detail.priceLevel?.price ?? 0,
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
      type: "subscribe",
      business_plan_price_label: detail.priceLevel?.name || "",
      grand_total: detail?.grandTotal || 0,
      id: detail._id.toString(),
      invoice_number: detail.invoiceNumber,
      business_plan_label: detail.master_license?.name ?? detail?.license_name,
      business_plan_price: detail.priceLevel?.price || 0,
      status: detail.status,
      payment_date: detail.updatedAt,
      payment_src: "CASH",
      payment_url: detail?.xendit_invoice_url || "",
      devices: new_data,
      total_details: detail.total_details,
      user: userData,
    };
  }

  function deviceResultBuilder(curr, detail, prev_expired, next_expired) {
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
              label: curr.license_label ?? detail.license_name,
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
  }

  async function processUpdateLicenseDevice(posId, outletID) {
    const { device_qty } = body;
    const LicenseDevices = await dbFetchLicenseDevice({
      active: true,
      license: BSON.ObjectId(user_data.license.toString()),
    });
    const dataUpdate = {
      _partition: posId.outlet.toString(),
      user_id: BSON.ObjectId(user_data._id.toString()),
      license_device_id: BSON.ObjectId(LicenseDevices[0]._id.toString()),
    };
    if (device_qty > 1) dataUpdate.name = "Kasir 1";

    await dbUpdatePosIds(
      { _id: BSON.ObjectId(posId._id.toString()) },
      dataUpdate
    );

    if (device_qty > 1) {
      await dbCreatePosIds(outletID, LicenseDevices);
    }
    await dbUpdatePosIdLicenseDevice();
  }

  async function processAddLicenseDevice() {
    const { outlet_id: outletID } = body;
    const LicenseDevices = await dbFetchLicenseDevice({
      pos_id: { $exists: false },
      license: BSON.ObjectId(user_data.license.toString()),
    });
    const totalPosIdAlready = await dbGetCountPosId();
    await dbCreatePosIdsAddLicense(outletID, LicenseDevices, totalPosIdAlready);
    await dbUpdatePosIdAddLicenseDevice(outletID);
  }

  async function executeDefaultData(outletID, country_id) {
    return context.functions.execute("intStoringDefaultData", {
      user_id: user_data._id.toString(),
      license: user_data.license.toString(),
      outlet_id: outletID.toString(),
      country_id,
    });
  }

  async function validate() {
    // Validate form
    valid.isEmail(body.email, "E20007BE");
    valid.isRequired(body, "phone", "E20002BE");
    valid.isPhoneNumber(body.phone, "E20003BE");
    valid.isRequired(body, "pin", "E20030BE");
    valid.isRequired(body, "password", "E20010BE");
    valid.isPassword(body.password);

    // check if user exsist
    body.username = body.email;
    await dbValidationExistUser();
  }

  async function validateLicense() {
    const licensePaymentMedia = await dbValidationPaymentMedia();
    const { license_data, licensePriceLevel } =
      await dbValidationMasterLicense();

    return { licensePaymentMedia, license_data, licensePriceLevel };
  }

  function construcUserLicense() {
    return {
      _id: user_data.license,
      _partition: "",
      __v: 0,
      user_id: user_data._id,
      email: user_data.email,
      phoneNumber: user_data.phone,
      active: true,
      createdAt: new Date(),
      createdBy: ctx_user_id,
      updatedAt: new Date(),
      updatedBy: ctx_user_id,
      country_id: BSON.ObjectId(body.business.country_id.toString()),
    };
  }

  async function construcLicensePaymentOther() {
    //access internal to clientSubscription, method ADMIN_SUBSCRIBE untuk create invoice & user_licens_payment
    const {
      device_qty,
      master_license_id,
      master_license_price_level,
      master_license_discount,
      duration,
      tax,
      total,
    } = body;

    let data_payload = {
      license_id: newUserLicense._id.toString(),
      total_device: parseInt(device_qty),
    };

    if (
      master_license_price_level &&
      master_license_discount &&
      master_license_id
    ) {
      (data_payload.business_plan_id = master_license_id.toString()),
        (data_payload.master_license_price_level =
          master_license_price_level.toString());
      data_payload.master_license_discount = master_license_discount.toString();
    }

    if (duration >= 1 && total > -1) {
      data_payload = {
        ...data_payload,
        duration,
        tax,
        total,
      };
    }

    return await context.functions
      .execute("clientSubscription", {
        method: "ADMIN_SUBSCRIBE",
        data: data_payload,
      })
      .then((data) => {
        if (data?.name === "Error") {
          console.log(data.message);
          throw new Error("E40001BE");
        }
      });
  }

  async function construcLicense() {
    // generate invoiceNumber
    const invoiceNumber = await intRegisterOrExtend.generateInvoice();
    // create new user license payment
    const newUserLicensePayment = constructNewLicensePayment(invoiceNumber);
    const expiredDate = valid.generateExpiredDate(
      licensePriceLevel?.expiryDay ?? license_data.duration
    );

    const license_device_data = await constructLicenseDevice(
      expiredDate,
      newUserLicensePayment
    );

    return {
      user_license_device: license_device_data,
      user_license: newUserLicense,
      user_license_payment: newUserLicensePayment,
    };
  }

  function constructNewLicensePayment(invoiceNumber) {
    const { device_qty, master_license_price_level } = body;
    const { user_license_payment: ulp } = collectionEnums;
    const totalPayment = licensePriceLevel
      ? parseFloat(licensePriceLevel.price * device_qty)
      : license_data.total;
    const subTotal =
      totalPayment == 0
        ? parseFloat(0)
        : totalPayment /
          (parseFloat(licensePriceLevel?.tax ?? license_data.tax) / 100 + 1);

    return {
      _id: new BSON.ObjectId(),
      _partition: "", // harus di isi setelah memasukkan outlet
      __v: parseInt(0),
      master_license_price_level: master_license_price_level
        ? BSON.ObjectId(master_license_price_level.toString())
        : null,
      masterLicenseId: license_data?._id ?? null,
      license: newUserLicense._id,
      license_name: license_data.name,
      license_duration: licensePriceLevel?.expiryDay ?? license_data.duration,
      payment_media_id: licensePaymentMedia._id,
      user_id: user_data._id,
      status: ulp.status.paid,
      paidDate: new Date(),
      note: "",
      invoiceNumber: invoiceNumber,
      dueDate: new Date(),
      discount: licensePriceLevel?.discNominal
        ? parseFloat(licensePriceLevel.discNominal)
        : parseFloat(0),
      tax:
        subTotal == 0
          ? parseFloat(subTotal)
          : licensePriceLevel?.tax
          ? parseFloat(licensePriceLevel.tax)
          : parseFloat(license_data.tax),
      price: licensePriceLevel?.price
        ? parseFloat(licensePriceLevel.price)
        : parseFloat(license_data.total),
      sub_total: parseFloat(subTotal),
      grandTotal: licensePriceLevel?.price
        ? parseFloat(
            licensePriceLevel.price * device_qty - licensePriceLevel.discNominal
          )
        : parseFloat(totalPayment),
      operator: ulp.operator.public,
      type: license_data?._id ? ulp.type.subscribed : ulp.type.custom,
      totalDevicesPaid: parseInt(device_qty),
      active: true,
      createdAt: new Date(),
      createdBy: ctx_user_id,
      updatedAt: new Date(),
      updatedBy: ctx_user_id,
    };
  }

  async function constructLicenseDevice(expiredDate, newUserLicensePayment) {
    let lastLicenseDevice = body?.email
      ? 0
      : await intRegisterOrExtend.getLastLicense({
          license: BSON.ObjectId(user_data.license.toString()),
        });

    const { device_qty } = body;

    const license_device_data = Array(parseInt(device_qty))
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
          payment: newUserLicensePayment._id,
          active: true,
          user_id: user_data._id,
          license: newUserLicense._id,
          license_uuid: valid.generateUUID(),
          license_label: `LICENSE ${lastLicenseDevice}`,
          createdAt: new Date(),
          createdBy: ctx_user_id,
          updatedAt: new Date(),
          updatedBy: ctx_user_id,
        };
      });

    return license_device_data;
  }

  async function getRegName() {
    return {
      city: await dbFetchCityName(),
      province: await dbFetchProvinceName(),
    };
  }

  function prepareDataToSave(regData) {
    const { city } = regData;
    const outletId = new BSON.ObjectId();
    const dataToSave = {};
    const { business } = body;
    // copy from master data
    const patternData = {
      _partition: outletId.toString(),
      __v: 0,
      user_id: user_data._id,
      outlet: outletId,
      license: user_data.license,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx_user_id,
      updatedBy: ctx_user_id,
    };

    // save business brand
    dataToSave.newBusiness = {
      ...patternData,
      _id: new BSON.ObjectId(),
      _partition: "",
      category: new BSON.ObjectId(business.business_category_id),
      name: business.business_name,
      outlet: [outletId],
    };

    //create new outlet
    dataToSave.newOutlet = {
      ...patternData,
      _id: outletId,
      _partition: "",
      name: business.outlet_name,
      business_id: dataToSave.newBusiness._id,
      pos: [],
      country: new BSON.ObjectId(business.country_id),
      province: new BSON.ObjectId(business.province_id),
      city: new BSON.ObjectId(business.city_id),
      subdistrict: new BSON.ObjectId(business.subdistrict_id),
      address: business.address,
      phone_number: user_data.phone,
      open_time: new Date(new Date().setHours(0, 0, 0, 0)),
      close_time: new Date(new Date().setHours(23, 59, 59, 999)),
      report_start_date: new Date(new Date().setHours(1, 0, 0, 0)),
      report_end_date: new Date(new Date().setHours(10, 0, 0, 0)),
    };

    if (business.postal_code) {
      dataToSave.newOutlet.postalCode = business.postal_code;
    }

    // acl to save
    const list_acl = context.functions.execute("intTranslatingAcl");
    dataToSave.acl = {
      ...patternData,
      _id: new BSON.ObjectId(),
      ...list_acl.reduce((prev, curr) => ({ ...prev, [curr]: true }), {}),
    };

    dataToSave.updateBillDesign = {
      business_id: dataToSave.newBusiness._id,
      business_name: dataToSave.newBusiness.name,
      outlet: dataToSave.newOutlet._id,
      outlet_name: dataToSave.newOutlet.name,
      address: dataToSave.newOutlet.address,
      city: BSON.ObjectId(business.city_id),
      city_name: city,
      phone_number: user_data.phone,
      memo: "Thank you!",
      image_logo: "",
    };

    return dataToSave;
  }

  async function createUserCredentials(outlet_id) {
    const user_acl = await dbGetAcl();
    const { pin } = body;

    const user_credential = {
      _id: new BSON.ObjectId(),
      _partition: outlet_id.toString(),
      __v: 0,
      outlet: outlet_id,
      user_id: ctx_user_id,
      id_user: user_data._id,
      acl: user_acl._id,
      active: true,
      fullname: user_data.fullname,
      username: user_data.username,
      license: user_data.license,
      phone: user_data.phone,
      pin: pin,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx_user_id,
      updatedBy: ctx_user_id,
    };

    await dbUpsertUserCredential(user_credential);
  }

  //--------------- DB function ----------------

  async function dbUpdateLicensePayment(filter, dataUpdate) {
    await db
      .collection(collectionNames.user_license_payment)
      .updateMany(filter, {
        $set: dataUpdate,
        $inc: { __v: 1 },
      });
  }

  async function dbGetDetailBilling(filter) {
    return db
      .collection(collectionNames.user_license_payment)
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
            license_name: 1,
            license_duration: 1,
            xendit_invoice_url: 1,
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
            detailDevicesExpired: 1,
          },
        },
      ])
      .toArray();
  }

  async function dbGetCountPosId() {
    return db
      .collection(collectionNames.pos_ids)
      .count({ license: BSON.ObjectId(user_data.license.toString()) });
  }

  async function dbGetAcl() {
    const exist = await db.collection(collectionNames.user_acl).findOne(
      {
        user_id: user_data._id,
        license: BSON.ObjectId(user_data.license.toString()),
      },
      { _id: 1 }
    );

    if (!exist) {
      throw new Error("E20048BE");
    }

    return exist;
  }

  async function dbUpsertUserCredential(user_credential) {
    await db
      .collection(collectionNames.user_credentials)
      .insertOne(user_credential);

    await db.collection(collectionNames.user).updateOne(
      {
        _id: user_data._id,
        license: BSON.ObjectId(user_data.license.toString()),
      },
      {
        $set: {
          credential_id: user_credential._id,
        },
      }
    );
  }

  async function dbInsertDataUser() {
    const newUserId = new BSON.ObjectId();
    const newUserLicenseId = new BSON.ObjectId();

    const newUser = {
      _id: newUserId,
      _partition: "",
      __v: 0,
      user_id: newUserId,
      username: body.username,
      password: valid.hashPassword(body.password),
      fullname: body.fullname.trim(),
      email: body.email,
      phone: body.phone,
      type: collectionEnums.user.type.owner,
      phone_confirmed: true,
      email_confirmed: true,
      license: newUserLicenseId,
      active: licensePaymentMedia.name !== "other",
      createdAt: new Date(),
      createdBy: ctx_user_id,
      updatedAt: new Date(),
      updatedBy: ctx_user_id,
      assignee: [ctx_user_id],
    };

    await db.collection(collectionNames.user).insertOne(newUser);
    return newUser;
  }

  async function dbInsertUserLicense() {
    return db
      .collection(collectionNames.user_license)
      .insertOne(newUserLicense);
  }

  async function dbUpdateBillDesign({ updateBillDesign }, billDesignID) {
    await db.collection(collectionNames.bill_design).updateOne(
      {
        _id: BSON.ObjectId(billDesignID.toString()),
        license: BSON.ObjectId(user_data.license.toString()),
      },
      {
        $set: updateBillDesign,
      }
    );
  }

  async function dbInsertDataLicense(data) {
    await db
      .collection(collectionNames.user_license)
      .insertOne(data.user_license);
    await db
      .collection(collectionNames.user_license_payment)
      .insertOne(data.user_license_payment);
    return await db
      .collection(collectionNames.user_license_device)
      .insertMany(data.user_license_device);
  }

  async function dbInsertDataAddLicense(data) {
    await db
      .collection(collectionNames.user_license_payment)
      .insertOne(data.user_license_payment);
    return await db
      .collection(collectionNames.user_license_device)
      .insertMany(data.user_license_device);
  }

  async function dbValidationExistUser() {
    const { username, phone } = body;
    const existingUser = await db
      .collection(collectionNames.user)
      .count({ $or: [{ username: username }, { phone: phone }] });

    if (existingUser > 0) {
      throw new Error("E30001BE");
    }
    return;
  }

  async function dbValidationPaymentMedia() {
    const { license_payment_media } = body;
    const licensePaymentMedia = await db
      .collection(collectionNames.license_payment_media)
      .findOne(
        { _id: BSON.ObjectId(license_payment_media), active: true },
        { _id: 1, name: 1 }
      );

    if (!licensePaymentMedia) {
      throw new Error("E30126BE");
    }
    return licensePaymentMedia;
  }

  async function dbValidationMasterLicense() {
    const {
      master_license_id,
      master_license_price_level,
      master_license_discount,
      total,
      duration,
      tax,
    } = body;

    if (total > -1 && duration >= 1) {
      return {
        license_data: {
          name: "custom",
          duration,
          total,
          tax,
        },
      };
    }

    const [license_data] = await db
      .collection(collectionNames.master_license)
      .aggregate([
        { $match: { _id: BSON.ObjectId(master_license_id), active: true } },
        {
          $lookup: {
            from: "master_license_price_level",
            let: { priceLevel: { $ifNull: ["$priceLevel", []] } },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      {
                        $eq: [
                          "$_id",
                          BSON.ObjectId(master_license_price_level),
                        ],
                      },
                      { $in: ["$_id", "$$priceLevel"] },
                    ],
                  },
                  active: true,
                },
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
                $match: {
                  $expr: {
                    $and: [
                      {
                        $eq: ["$_id", BSON.ObjectId(master_license_discount)],
                      },
                      { $in: ["$_id", "$$discount"] },
                    ],
                  },
                  active: true,
                },
              },
            ],
            as: "discounts",
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            priceLevel: 1,
            discount: 1,
            master_license_price_level: {
              price: 1,
              discNominal: 1,
              expiryDay: 1,
              tax: 1,
            },
            discounts: { minQty: 1 },
          },
        },
      ])
      .toArray();

    if (!license_data) throw new Error("E50008BE");

    if (license_data.master_license_price_level.length <= 0)
      throw new Error("E30091BE");

    if (license_data.discounts.length <= 0) throw new Error("E30088BE");

    return {
      license_data,
      licensePriceLevel: license_data.master_license_price_level[0],
    };
  }

  async function dbInsertACLBusinessAndOutlet({ acl, newBusiness, newOutlet }) {
    await db.collection(collectionNames.user_acl).insertOne(acl);
    await db.collection(collectionNames.user_business).insertOne(newBusiness);
    await db.collection(collectionNames.outlet).insertOne(newOutlet);
  }

  async function dbFetchCityName() {
    const { business } = body;
    const city = await db
      .collection("master_reg_city")
      .findOne({ _id: BSON.ObjectId(business.city_id) }, { _id: 1, name: 1 });
    return city.name;
  }

  async function dbFetchProvinceName() {
    const { business } = body;
    const province = await db
      .collection("master_reg_state")
      .findOne({ _id: BSON.ObjectId(business.province_id) }, { name: 1 });
    return province.name;
  }

  async function dbUpdatePosIds(filter, dataUpdate) {
    return db
      .collection(collectionNames.pos_ids)
      .updateOne(filter, { $set: dataUpdate });
  }

  async function dbFetchLicenseDevice(filter) {
    return db
      .collection(collectionNames.user_license_device)
      .find(filter, { _id: 1 })
      .toArray();
  }

  async function dbCreatePosIds(outlet_id, LicenseDevices) {
    const { device_qty } = body;
    let idx = 1;
    const ExdeviceQty = device_qty - 1;
    const dataPosIds = [];
    const user_id = BSON.ObjectId(user_data._id.toString());

    for (let i = 0; i < ExdeviceQty; i++) {
      dataPosIds.push({
        __v: 0,
        _id: new BSON.ObjectId(),
        _partition: outlet_id.toString(),
        active: true,
        outlet: BSON.ObjectId(outlet_id.toString()),
        license: BSON.ObjectId(user_data.license.toString()),
        user_id: user_id,
        name: `Kasir ${idx + 1}`,
        createdAt: new Date(),
        createdBy: user_id,
        updatedAt: new Date(),
        updatedBy: user_id,
        license_device_id: LicenseDevices[idx]._id,
      });
      idx++;
    }
    return db.collection(collectionNames.pos_ids).insertMany(dataPosIds);
  }

  async function dbCreatePosIdsAddLicense(
    outlet,
    LicenseDevices,
    totalPosIdAlready = 0
  ) {
    let idx = 0;
    let counterName = totalPosIdAlready || 1;
    const userid = BSON.ObjectId(user_data._id.toString());
    const { device_qty } = body;
    const dataPosIds = [];

    for (let i = 0; i < device_qty; i++) {
      counterName = counterName + 1;
      dataPosIds.push({
        __v: 0,
        _id: new BSON.ObjectId(),
        _partition: outlet.toString(),
        active: true,
        outlet: BSON.ObjectId(outlet.toString()),
        license: BSON.ObjectId(user_data.license.toString()),
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

    await db.collection(collectionNames.pos_ids).insertMany(dataPosIds);
    return dataPosIds;
  }

  async function dbUpdatePosIdLicenseDevice() {
    const listPosIds = await db
      .collection(collectionNames.pos_ids)
      .find({ user_id: BSON.ObjectId(user_data._id.toString()) })
      .toArray();

    await dbUpdateOutlet(listPosIds);

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

    return db
      .collection(collectionNames.user_license_device)
      .bulkWrite(updateData);
  }

  async function dbUpdateOutlet(listPosIds) {
    const posIds = listPosIds.map((x) => BSON.ObjectId(x._id.toString()));
    const outlet = listPosIds[0].outlet;
    const license = listPosIds[0].license;

    return db.collection(collectionNames.outlet).updateOne(
      {
        _id: BSON.ObjectId(outlet.toString()),
        license: license,
      },
      {
        $set: {
          pos: posIds,
        },
      }
    );
  }

  async function dbUpdatePosIdAddLicenseDevice(outletID) {
    const listPosIds = await db
      .collection(collectionNames.pos_ids)
      .find({
        user_id: BSON.ObjectId(user_data._id.toString()),
        outlet: BSON.ObjectId(outletID.toString()),
        license_device_id: { $exists: true },
      })
      .toArray();

    await dbUpdateOutletAddLicense(listPosIds, outletID);
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
    return await db
      .collection(collectionNames.user_license_device)
      .bulkWrite(updateData);
  }

  async function dbUpdateOutletAddLicense(listPosIds, outletID) {
    const posIds = listPosIds.map((x) => BSON.ObjectId(x._id.toString()));
    const license = listPosIds[0].license;

    return db.collection(collectionNames.outlet).updateOne(
      {
        _id: BSON.ObjectId(outletID.toString()),
        license: license,
      },
      {
        $set: {
          pos: posIds,
        },
      }
    );
  }
};
