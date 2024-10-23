const crypto = require("crypto");

module.exports = function () {
  const user = context.functions.execute("intUserContext");

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const crypto = require("crypto");

  const isObjValid = (obj, key, errorCode, required, defData) => {
    if (Object.keys(obj).indexOf(key) == -1) throw new Error(errorCode);
    if (
      required &&
      (obj[key] === null || obj[key] === undefined || obj[key] === "")
    )
      throw new Error(errorCode);
    if (required && Array.isArray(obj[key]) && obj[key].length === 0)
      throw new Error(errorCode);
    if (defData && obj[key] !== defData) throw new Error(errorCode);
    return true;
  };

  const isRequired = (obj, key, errorCode, defData) => {
    if (Object.keys(obj).indexOf(key) == -1) throw new Error(errorCode);
    if (obj[key] === null || obj[key] === undefined || obj[key] === "")
      throw new Error(errorCode);
    if (Array.isArray(obj[key]) && obj[key].length === 0)
      throw new Error(errorCode);
    if (defData && obj[key] !== defData) throw new Error(errorCode);
    return true;
  };

  const isUnique = async (obj, schema, key, errorCode) => {
    if (!obj[key]) return true; // jika tidak ada ada datanya, langsung return value

    const filter = {
      // default filter
      license: BSON.ObjectId(user.license.toString()),
    };

    if (obj.outlet_id || obj.outlet) {
      // payload filter
      filter.outlet = obj.outlet_id
        ? BSON.ObjectId(obj.outlet_id.toString())
        : BSON.ObjectId(obj.outlet.toString());
    }

    let objToCompare = obj[key];
    if (typeof objToCompare !== "number") {
      // replace "+" character dengan "[+]"
      // karena kasus nomor HP "+62856", tanda "+" di anggap bagian dari regex
      objToCompare = objToCompare.replace(/\+/g, "[+]");
      // replace "*" character dengan "[*]"
      objToCompare = objToCompare.replace(/\*/g, "[*]");
      // Karakter backslash "\" harus di-escape menjadi "\\""
      // karena backslah mempunyai arti khusus di regex
      objToCompare = objToCompare.replace(/\\/g, "\\$&");
    }

    // exact match and case-insensitive
    filter[key] = { $regex: `^${objToCompare}$`, $options: "i" };
    if (obj.id) {
      filter._id = { $ne: BSON.ObjectId(obj.id.toString()) };
    }

    const data = await db.collection(schema).count(filter);
    if (Number(data) != 0) throw new Error(errorCode);
    return true;
  };

  // validasi unique item dengan input array
  // tested pada validasi variantItem, validasi berdasarkan SKU dan Name
  const isUniqueByArray = async (
    schema,
    outlet_id,
    keys, // ['name', 'sku']
    values, // array of object [{name: 'A', sku: '01'}]
    errorCode
  ) => {
    //  grouping, new and old item
    values = values.reduce(
      (prev, item) => {
        if (item.id) {
          prev.oldData = [...prev.oldData, item];
        }

        if (!item.id) {
          prev.newData = [...prev.newData, item];
        }

        return prev;
      },
      {
        oldData: [],
        newData: [],
      }
    );

    let filterKeys = {
      $expr: {
        $or: [],
      },
    };

    keys.forEach((key) => {
      // * tambahakan filter dari  item baru
      // => example: {$in: ["$sku", ["01", "02"]]}
      filterKeys.$expr.$or.push({
        $in: [
          `$${key}`,
          values.newData.reduce((prev, el) => {
            if (!el[key]) {
              return prev;
            }
            return [...prev, el[key]];
          }, []),
        ],
      });

      // filter dari  item yang sudah pernah di simpan
      values.oldData.forEach((each) => {
        if (!each[key]) {
          return;
        }
        filterKeys.$expr.$or.push({
          $and: [
            { $eq: [`$${key}`, each[key]] },
            { $ne: [`$_id`, BSON.ObjectId(each.id.toString())] },
          ],
        });
      });
    });

    if (filterKeys.$expr.$or.length == 0) {
      return;
    }

    let filter = {
      license: BSON.ObjectId(user.license.toString()),
      outlet: BSON.ObjectId(outlet_id.toString()),
      ...filterKeys,
    };

    const data = await db.collection(schema).count(filter);

    if (Number(data) != 0) throw new Error(errorCode);
    return true;
  };

  const isDataExists = async (schema, params, errorCode) => {
    const filter = {
      // default filter
      license: BSON.ObjectId(user.license.toString()),

      ...params,
    };

    const isExists = (await db.collection(schema).count(filter)) > 0;

    if (!isExists && errorCode) throw new Error(errorCode);

    return isExists;
  };

  const hasPermission = async (permission, throwError = true) => {
    const acl = await context.functions.execute("clientUserAcl", {
      method: "FETCH_ACL",
    });

    let permissions = [];
    if (!Array.isArray(permission)) {
      permissions.push(permission);
    } else {
      permissions = [...permission];
    }

    // jika tidak ditemukan acl yang true
    if (permissions.findIndex((p) => acl[p]) == -1) {
      if (throwError) {
        // di ijinkan untuk throw error
        throw new Error("E10001BE");
      } else {
        // tidak di ijinkan untuk throw error
        return false;
      }
    }

    // jika ditemukan acl yang true
    return true;
  };

  const isAuthenticated = () => {
    // authenticate user, if user already login and exist in schema user
    // the response will be true
    if (Object.keys(user).length === 0) {
      throw new Error("E10001BE");
    }
    return true;
  };

  const isArray = (obj, key, errorCode, hasValue) => {
    if (!Array.isArray(obj[key])) throw new Error(errorCode);
    if (hasValue) {
      if (obj[key].length == 0) throw new Error(errorCode);
    }
  };

  const isNumber = (value, errorCode) => {
    if (typeof value != "number") throw new Error(errorCode);
  };

  const isString = (value, errorCode) => {
    if (typeof value != "string") throw new Error(errorCode);
  };

  const isTrue = (value, errorCode) => {
    if (!value) throw new Error(errorCode);
  };

  const enumOpt = (obj, key, opt, errorCode) => {
    if (opt.indexOf(obj[key]) == -1) throw new Error(errorCode);
  };

  const isEmail = (data, errorCode) => {
    if (/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,5})+$/gi.test(data)) {
      return true;
    }

    throw new Error(errorCode ?? "E20007BE");
  };

  const isGender = (gender) => {
    if (["male", "female"].indexOf(gender) > -1) {
      return true;
    }

    throw new Error(errorCode ?? "E20149BE");
  };

  const isPIN = (pin) => {
    if (/^\d{4}$/gi.test(pin)) {
      return true;
    }

    throw new Error("E20220BE");
  };

  const isPassword = (password) => {
    if (!/^(?=.*\d)(?=.*[a-zA-Z])[a-zA-Z0-9]{8,32}$/.test(password)) {
      throw new Error("E20012BE");
    }
  };

  const isPhoneNumber = (data, errorCode) => {
    if (/^\+\d{11,14}$/gi.test(data)) {
      return true;
    } else {
      throw new Error(errorCode ?? "E20003BE");
    }
  };

  const hashPassword = (password) => {
    return crypto
      .createHmac("sha256", context.values.get("SECRET_PASSWORD_SALT"))
      .update(password)
      .digest("hex");
  };

  const generateUUID = () => {
    const newId = new BSON.ObjectId().toString();
    const partLength = Math.floor(newId.length / 3);

    const [first, second, third] = newId.match(
      new RegExp(`.{1,${partLength}}`, "g")
    );

    return `${third}-${first}-${second}`;
  };

  const generateExpiredDate = (expiryDay) => {
    let expiredDate = 1000 * 60 * 60 * 24 * expiryDay; // 1 hari dikali expiryDay
    expiredDate = new Date(+new Date() + expiredDate);
    expiredDate.setHours(23, 59, 59, 999);
    return expiredDate;
  };

  return Object.freeze({
    isObjValid,
    isUnique,
    isDataExists,
    hasPermission,
    isAuthenticated,
    isArray,
    enumOpt,
    isRequired,
    isNumber,
    isString,
    isTrue,
    isEmail,
    isGender,
    isPIN,
    isPassword,
    isPhoneNumber,
    hashPassword,
    generateUUID,
    generateExpiredDate,
    isUniqueByArray,
  });
};
