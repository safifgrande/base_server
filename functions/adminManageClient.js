module.exports = async (payload) => {
  try {
    const generalFunction = await adminManageClient(payload);

    const { method } = payload;

    if (generalFunction[method]) {
      return await generalFunction[method]();
    } else {
      return "method is not exists";
    }
  } catch (error) {
    console.log(error);
    return context.functions.execute(
      "handleCatchError",
      error,
      payload,
      "adminManageClient"
    );
  }
};

const adminManageClient = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");
  const db = mongodb.db(context.values.get("DB_NAME"));
  const user = context.functions.execute("intUserContext");

  /*
    exports({
      method: 'UPDATE_PASSWORD',
      data: {
        user_id: [string | required],
        password: [string | required]
      }
    })

    1. validate payload
    2. update user
  */

  const UPDATE_PASSWORD = async () => {
    // 1. validate payload
    updatePasswordValidation();
    // 2. update user
    await dbUpdatePasswordUser();

    return {
      status: true,
      message: "success",
      data: null,
      error: "",
    };
  };

  /*
    exports({
      method: 'WIPE_TRANSACTION',
      data: {
        license: [string | required],
        password: [string | required],
        outlet_id: [string | required],
      }
    })
  */

  const WIPE_TRANSACTION = async () => {
    valid.isObjValid(payload.data, "password", "E20010BE", true);
    valid.isObjValid(payload.data, "license", "E20148BE", true);
    valid.isObjValid(payload.data, "outlet_id", "E20033BE", true);

    // 1. validate payload
    await validatePassword();
    // 2. wipe transaction
    await dbWipeTransaction();

    return {
      status: true,
      message: "success",
      data: null,
      error: "",
    };
  };

  // ----------- Helper start -------------
  const updatePasswordValidation = () => {
    valid.isObjValid(context.user.data, "acl", "E10001BE", true);
    // WPC = Write Permission Client
    // ACL yang digunakan admin user
    if (context.user.data.acl.indexOf("WPC") === -1) {
      throw new Error("E10001BE");
    }

    valid.isObjValid(payload, "data", "E20038BE", true);
    valid.isObjValid(payload.data, "user_id", "E20035BE", true);
    valid.isObjValid(payload.data, "password", "E20010BE", true);
    valid.isPassword(payload.data.password);
  };

  const validatePassword = async () => {
    const {
      data: { license, password },
    } = payload;

    const user = await db.collection(collectionNames.user).findOne(
      {
        license: BSON.ObjectId(license.toString()),
        password: valid.hashPassword(password),
      },
      {
        _id: 1,
      }
    );

    if (!user) throw new Error("E30006BE");
  };
  // ----------- DB start -----------------

  const dbResetData = async (collection, dataUpdate) => {
    await db.collection(collection).updateMany(
      {
        license: BSON.ObjectId(payload.data.license.toString()),
        outlet: BSON.ObjectId(payload.data.outlet_id.toString()),
      },
      {
        $set: {
          ...dataUpdate,
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id),
        },
        $inc: { __v: 1 },
      }
    );
  };

  const dbWipeTransaction = async () => {
    const matchParams = {
      license: BSON.ObjectId(payload.data.license.toString()),
      outlet: BSON.ObjectId(payload.data.outlet_id.toString()),
    };

    const removedColl = [
      collectionNames.transaction,
      collectionNames.transaction_action,
      collectionNames.transaction_detail,
      collectionNames.transaction_item,
      collectionNames.transaction_payment,
      collectionNames.transaction_lock,
      collectionNames.transaction_payment_pending,
      collectionNames.transaction_taxes,
      collectionNames.invoice_payment,
      collectionNames.invoice_payment_history,
      collectionNames.shift_sales_props,
      collectionNames.shift_sales,
      collectionNames.shift_qty_value,
      collectionNames.shift_products,
      collectionNames.shift_product_items,
      collectionNames.shift_product_groups,
      collectionNames.shift_product_departments,
      collectionNames.shift_cash_flow,
    ].map(async (v) => {
      return db.collection(v).deleteMany(matchParams);
    });

    await Promise.all(removedColl);

    // reset data member (total visit, total spent, & last visit)
    await dbResetData(collectionNames.member, {
      total_visit: 0,
      total_spent: 0,
      last_visit: null,
    });

    // reset qty produk stock
    await dbResetData(collectionNames.product_stock, {
      quantity: parseFloat(0),
    });
  };

  const dbUpdatePasswordUser = async () => {
    const {
      data: { user_id, password },
    } = payload;

    await db.collection(collectionNames.user).updateOne(
      { _id: BSON.ObjectId(user_id.toString()) },
      {
        $set: {
          password: valid.hashPassword(password),
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user._id),
        },
        $inc: { __v: 1 },
      }
    );
  };

  return Object.freeze({
    UPDATE_PASSWORD,
    WIPE_TRANSACTION,
  });
};
