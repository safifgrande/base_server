exports = async (payload) => {
  try {
    const packageObject = generalFunction(payload);
    const { method } = payload;
    if (packageObject[method]) {
      return await packageObject[method]();
    } else {
      return true;
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientProductPackage"
    );
  }
};

const generalFunction = (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { license, _id } = context.functions.execute("intUserContext");

  /*
    Request :

    {
      "id":"61651066be699c90de1c632f",
      "name":"Pakt Seger cuk",
      "sku":"122345190",
      "type":"full",
      "active":true,
      "outlet":"611e1583f7bf5674c1785822",
      "include_tax":true,
      "sold_out":false,
      "prices":[
        {
          "id":"",
          "value":"35000",
          "price_level_name":"Normal",
          "price_level_id":"611e1583f7bf5674c1785833",
          "default":true
        }],
      "items":[
        {
          "id":"",
          "label":"Agnes Stiedemann-EXPLOIT0.49647510462123967",
          "required":false,
          "min":1,
          "max":1,
          "products":["612f48c0873e1584afa6749f"]
        },
        {
          "id":"",
          "label":"Ada Klein-EXPLOIT0.914287989281853",
          "required":false,
          "min":1,
          "max":1,
          "products":["612f4aa6a65d0d1b65ed20df"]
        }
      ]},
      "filter":{}
    }
  */
  /*
      1. validation
      2. validate package name and sku
      3. check, insert , and validate price price level
      4. get old data
      5. check, insert, and validate price
      6. check, insert, and validate package items
      7. save product package
    */
  const POST = async () => {
    payload.filter = {
      license,
      outlet: BSON.ObjectId(payload.data.outlet.toString()),
    };

    // 1. validation
    await validation();

    // 2. validate pacakge name and sku
    await validateNameAndSKU();

    // 3. check, insert , and validate price price level
    payload.data.prices = await handlePriceLevel();

    // 4. get old data
    const oldData = await getOldData();

    // valdiasi 'type' if update or oldData true
    if (oldData) {
      if (oldData.type !== payload.data.type) throw new Error("E30131BE");
    }

    // 5. check, insert, and validate price
    payload.data.prices = await handlePrices(oldData);

    // 5.1 handle package stock
    // fungsi ini memasukan has_stock dan qunatity stock (untuk v1)
    await handlePackageItemStock();

    // 6. check, insert, and validate package items
    payload.data.items = await handlePackageItems(oldData);
    // // 7. save product package
    return handleSavePackage(oldData);
  };

  const handlePackageItemStock = async () => {
    const {
      data: { items },
    } = payload;

    // find all data products and return just has_stock, _id and stock (for now just quantity stock)
    const productsId = [];

    items.forEach((item) => {
      item.products.forEach((product) => {
        productsId.push(BSON.ObjectId(product));
      });
    });

    const products = await db
      .collection(collectionNames.products)
      .aggregate([
        {
          $match: { _id: { $in: productsId }, license }, // need license
        },
        {
          $lookup: {
            from: "product_stock",
            let: { stocks: "$stocks" },
            pipeline: [
              {
                $match: { $expr: { $in: ["$_id", "$$stocks"] } },
              },
              {
                $project: {
                  quantity: 1,
                },
              },
            ],
            as: "stock",
          },
        },
        {
          $unwind: "$stock",
        },
        {
          $project: {
            _id: 1,
            stock: "$stock.quantity",
          },
        },
        {
          $sort: {
            stock: 1,
          },
        },
      ])
      .toArray();
    payload.data.stock = products[0]?.stock;
    payload.data.has_stock = false;
  };

  const validateNameAndSKU = async () => {
    const {
      filter,
      data: { id, name, sku },
    } = payload;

    const validateFilter = { ...filter, $or: [{ name }] };

    if (sku != "") {
      validateFilter["$or"].push({ sku });
    }

    if (name && name.length > 30) {
      throw new Error("E20014BE");
    }

    if (id) {
      // filter untuk update data
      validateFilter._id = { $ne: BSON.ObjectId(id) };
    }

    // nama dan sku package tidak boleh ada yang sama
    await valid.isUnique(
      payload.data,
      collectionNames.product_package,
      "name",
      "E30015BE"
    );
    await valid.isUnique(
      payload.data,
      collectionNames.product_package,
      "sku",
      "E30015BE"
    );

    // nama dan sku package tidak boleh sama seperti product

    await valid.isUnique(
      payload.data,
      collectionNames.products,
      "name",
      "E30033BE"
    );

    await valid.isUnique(
      payload.data,
      collectionNames.products,
      "sku",
      "E30015BE"
    );

    // nama dan sku package tidak boleh sama seperti menu variant
    await valid.isUnique(
      payload.data,
      collectionNames.product_menu_variant,
      "name",
      "E30045BE"
    );
  };

  const findDuplicatePriceLevel = (array) => {
    let duplicateItem = false;
    const tempArray = [];

    array.forEach((item) => {
      const finditem = tempArray.find((tempItem) => {
        return tempItem.price_level_name == item.price_level_name;
      });
      if (finditem) {
        duplicateItem = true;
      } else {
        tempArray.push(item);
      }
    });

    return duplicateItem;
  };

  const handlePriceLevel = async () => {
    const {
      filter,
      data: { prices },
    } = payload;

    const isDuplicate = findDuplicatePriceLevel(prices);

    if (isDuplicate) {
      throw new Error("E30099BE");
    }

    const priceLevelsId = [];
    const priceLevelsName = [];
    const priceLevelInsertQuery = [];
    const newPrices = prices.map((price) => {
      if (price.price_level_id) {
        // jika sudah ada price level id, check apakah price level id valid !
        priceLevelsId.push(BSON.ObjectId(price.price_level_id));
        return price;
      } else {
        // jika tidak ada price level id, check apakah nama price level sudah digunakan.
        priceLevelsName.push(price.price_level_name);
        priceLevelInsertQuery.push({
          insertOne: {
            document: {
              _id: new BSON.ObjectId(),
              name: price.price_level_name,
              default: false,
              _partition: filter.outlet.toString(),
              __v: 0,
              user_id: BSON.ObjectId(_id),
              outlet: filter.outlet,
              license: filter.license,
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              createdBy: BSON.ObjectId(_id),
              updatedBy: BSON.ObjectId(_id),
            },
          },
        });

        return { ...price, price_level_id: newPriceLevel.insertedId };
      }
    });

    if (priceLevelsId.length) {
      const findPriceLevels = await db
        .collection(collectionNames.price_levels)
        .find({ _id: { $in: priceLevelsId }, license })
        .toArray();

      if (priceLevelsId.length !== findPriceLevels.length) {
        throw new Error("E30013BE");
      }
    }

    if (priceLevelsName.length) {
      const findPriceLevels = await db
        .collection(collectionNames.price_levels)
        .find({ name: { $in: priceLevelsName }, license })
        .toArray();

      if (findPriceLevels.length > 0) {
        throw new Error("E30014BE");
      } else {
        await db
          .collection(collectionNames.price_levels)
          .bulkWrite(priceLevelInsertQuery);
      }
    }

    return newPrices;
  };

  const getOldData = async () => {
    const {
      filter,
      data: { id },
    } = payload;
    if (id) {
      return db
        .collection(collectionNames.product_package)
        .findOne({ ...filter, _id: BSON.ObjectId(id.toString()) });
    }

    return false;
  };

  const handlePrices = async (oldData) => {
    const {
      filter,
      data: { prices },
    } = payload;
    if (oldData) {
      // jika sudah ada old data, lakukan compare,
      // jika ada pengurangan prices,
      // data prices lama update filed `active = false`

      await handleDeletedPrice(oldData.prices, prices);
    }
    const priceQuery = [];

    const priceUpdateIds = [];

    const prices_id = prices.map(({ price_level_id, id, value }) => {
      if (id) {
        priceQuery.push({
          updateOne: {
            filter: {
              ...filter,
              _id: BSON.ObjectId(id),
            },
            update: {
              $set: {
                updatedAt: new Date(),
                updatedBy: BSON.ObjectId(_id),

                price_level: BSON.ObjectId(price_level_id.toString()),
                value: parseFloat(value),
              },
              $inc: { __v: 1 },
            },
          },
        });
        priceUpdateIds.push(BSON.ObjectId(id));
        return BSON.ObjectId(id);
      } else {
        const priceId = new BSON.ObjectId();
        priceQuery.push({
          insertOne: {
            document: {
              _id: priceId,
              _partition: filter.outlet.toString(),
              __v: 0,
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              createdBy: BSON.ObjectId(_id),
              updatedBy: BSON.ObjectId(_id),
              license: filter.license,
              outlet: filter.outlet,
              user_id: BSON.ObjectId(_id),

              price_level: BSON.ObjectId(price_level_id.toString()),
              value: parseFloat(value),
            },
          },
        });

        return priceId;
      }
    });

    if (priceUpdateIds.length > 0) {
      const findPrices = await db
        .collection(collectionNames.product_prices)
        .find({ _id: { $in: priceUpdateIds }, license })
        .toArray();

      if (priceUpdateIds.length !== findPrices.length) {
        throw new Error("E30018BE");
      }
    }

    await db.collection(collectionNames.product_prices).bulkWrite(priceQuery);
    return prices_id;
  };

  const handleDeletedPrice = async (oldPrices, newData) => {
    // find deleted prices
    const deletedPrices = oldPrices.reduce((prev, price_id) => {
      if (
        newData.findIndex((v) => v.id.toString() === price_id.toString()) == -1
      ) {
        return [...prev, BSON.ObjectId(price_id.toString())];
      }
      return [...prev];
    }, []);

    await db
      .collection(collectionNames.product_prices)
      .deleteOne({ _id: { $in: deletedPrices }, license });
  };

  const handlePackageItems = async (oldData) => {
    const {
      filter,
      data: { active, items },
    } = payload;

    if (oldData) {
      await handleDeletedItem(oldData.items, items);
    }

    const itemsQuery = [];
    const itemUpdateIds = [];

    const items_id = items.map((item) => {
      if (item.id) {
        // validate item, apakah id ada di DB atau tidak
        itemsQuery.push({
          updateOne: {
            filter: { ...filter, _id: BSON.ObjectId(item.id) },
            update: {
              $set: {
                updatedAt: new Date(),
                updatedBy: BSON.ObjectId(_id),

                label: item.label,
                products: item.products.map((v) => BSON.ObjectId(v.toString())),
                max: item.max,
                min: item.min,
                required: false,
                package_active: active,
              },
            },
          },
        });

        itemUpdateIds.push(BSON.ObjectId(item.id));

        return BSON.ObjectId(item.id.toString());
      } else {
        // data baru
        const item_id = new BSON.ObjectId();

        itemsQuery.push({
          insertOne: {
            document: {
              _id: item_id,
              _partition: filter.outlet.toString(),
              __v: 0,
              active: true,
              package_active: active,
              createdAt: new Date(),
              updatedAt: new Date(),
              createdBy: BSON.ObjectId(_id),
              updatedBy: BSON.ObjectId(_id),
              license: filter.license,
              outlet: filter.outlet,
              user_id: BSON.ObjectId(_id),

              label: item.label,
              products: item.products.map((v) => BSON.ObjectId(v.toString())),
              max: item.max,
              min: item.min,
              required: false,
            },
          },
        });

        return item_id;
      }
    });
    if (itemUpdateIds.length > 0) {
      const findItems = await db
        .collection(collectionNames.product_package_item)
        .find({ _id: { $in: itemUpdateIds }, license })
        .toArray();

      if (itemUpdateIds.length !== findItems.length) {
        throw new Error("E30019BE");
      }
    }

    await db
      .collection(collectionNames.product_package_item)
      .bulkWrite(itemsQuery);

    return items_id;
  };

  const handleDeletedItem = async (oldItem, newItem) => {
    const {
      data: { type },
    } = payload;

    const deletedItem = oldItem.reduce((prev, item) => {
      if (
        newItem.findIndex((v) => v.id?.toString() === item.toString()) == -1
      ) {
        return [...prev, BSON.ObjectId(item.toString())];
      }
      return [...prev];
    }, []);

    await db.collection(collectionNames.product_package_item).deleteMany({
      _id: { $in: deletedItem },
      license,
    });

    return deletedItem;
  };

  const handleSavePackage = async (oldData) => {
    const {
      filter,
      data: {
        id,
        name,
        sku,
        type,
        prices,
        items,
        active,
        outlet,
        include_tax,
        sold_out,
        image_url,
      },
    } = payload;

    if (id) {
      // update data

      // check request has image_url change
      if (
        oldData.image_url &&
        (image_url || image_url === "") &&
        image_url !== oldData.image_url
      ) {
        await context.functions.execute("intRemoveImage", {
          image_url: oldData.image_url,
        });
      }

      // validate item, apakah id ada di DB atau tidak
      const foundPackage = await db
        .collection(collectionNames.product_package)
        .findOneAndUpdate(
          { ...filter, _id: BSON.ObjectId(id) },
          {
            $set: {
              updatedAt: new Date(),
              updatedBy: BSON.ObjectId(_id),

              outlet: BSON.ObjectId(outlet),
              items: items,
              name: name,
              prices: prices,
              sku: sku,
              type: type,
              sold_out,
              include_tax:
                typeof include_tax === "boolean" ? include_tax : false,
              active: active !== null ? active : oldData.active,
              image_url,
            },
            $inc: { __v: 1 },
          },
          {
            projection: { _id: 1 },
          }
        );

      if (!foundPackage) {
        // jika return null, artinya id tidak ditemukan di DB
        throw new Error("E30019BE");
      }

      return id;
    } else {
      // mengambil deparment denga type package
      const dept = await db
        .collection(collectionNames.product_departments)
        .findOne(
          {
            name: "package",
            outlet: filter.outlet,
            license,
          },
          { _id: 1 }
        );

      if (!dept) throw new Error("E30049BE");

      // insert new data
      const newPackage = await db
        .collection(collectionNames.product_package)
        .insertOne({
          _id: new BSON.ObjectId(),
          _partition: filter.outlet.toString(),
          __v: 0,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: BSON.ObjectId(_id),
          updatedBy: BSON.ObjectId(_id),
          license: filter.license,
          outlet: BSON.ObjectId(outlet),
          user_id: BSON.ObjectId(_id),

          items: items,
          name: name,
          prices: prices,
          sku: sku,
          type: type,
          product_department: dept._id,
          include_tax: typeof include_tax === "boolean" ? include_tax : false,
          sold_out,
          has_stock: payload.data.has_stock,
          image_url,
        });
      return newPackage.insertedId.toString();
    }
  };

  const validation = async () => {
    // 1. validate ACL
    await valid.hasPermission("bo_product");

    if (payload.data.id) {
      // validation items
      if (payload.data.active) {
        await validationItemsIsNonactive(
          BSON.ObjectId(payload.data.id.toString())
        );
      }
    }

    valid.isObjValid(payload.data, "sold_out", "E20138BE", true);
    valid.isObjValid(payload.data, "active", "E20062BE", true);
    valid.isObjValid(payload.data, "name", "E20039BE", true);
    valid.isObjValid(payload.data, "outlet", "E20033BE", true);
    valid.isObjValid(payload.data, "type", "E20040BE", true);
    valid.isObjValid(payload.data, "prices", "E20041BE", true);
    valid.isObjValid(payload.data, "items", "E20042BE", true);
    valid.isArray(payload.data, "prices", "E20041BE", true);
    valid.isArray(payload.data, "items", "E20042BE", true);
    valid.enumOpt(payload.data, "type", ["full", "partial"], "E20040BE");
    payload.data.prices.map((v) => {
      valid.isObjValid(v, "value", "E20041BE", true);
      valid.isObjValid(v, "price_level_name", "E20043BE", true);
    });

    const temp = [];
    payload.data.items.map((v) => {
      valid.isObjValid(v, "label", "E20042BE", true);
      valid.isObjValid(v, "min", "E20044BE", true);
      valid.isObjValid(v, "max", "E20044BE", true);
      valid.isTrue(v.min <= v.max, "E20129BE");
      valid.isNumber(v.min, "E20128BE");
      valid.isNumber(v.max, "E20128BE");
      valid.isObjValid(v, "products", "E20046BE", true);
      valid.isArray(v, "products", "E20046BE", true);

      // mencari duplicate product, dalam satu paket produk hanya digunakan sekali
      v.products.map((product) => {
        if (temp.indexOf(product) > -1) {
          throw new Error("E20045BE");
        }

        temp.push(product);
      });
    });

    // validate product items
    const totalProduct = await db.collection(collectionNames.products).count({
      active: true,
      _id: { $in: temp.map((v) => BSON.ObjectId(v.toString())) },
      license,
    });
    if (totalProduct !== temp.length) {
      throw new Error("E30017BE");
    }

    if (payload.data.id) {
      await valid.isDataExists(
        collectionNames.product_package,
        {
          ...payload.filter,
          _id: BSON.ObjectId(payload.data.id),
        },
        "E30063BE"
      );
    }
  };

  /*
    exports({
      method: 'LIST',
      filter: {
        business_id: '',
        outlet_id: optional
      }
    })
  */
  const LIST = async () => {
    const { filter } = payload;

    // default filter
    filter.license = BSON.ObjectId(license.toString());

    // validate ACL tapi tidak perlu throw error
    await validateGetList(filter);
    const productPackage = await dbLISTGetPackage(payload);

    return productPackage.map((pack) => {
      delete pack.lowerName;
      let listStock = [];

      pack.items = pack.items.map((item) => {
        item.id = item._id.toString();
        delete item._id;
        item.products = item.products.map((product) => {
          product.id = product._id.toString();
          if (product.has_stock)
            listStock.push(Math.floor(product.stocks.quantity / item.max));
          delete product._id;
          return product;
        });
        return item;
      });
      pack.stock = listStock.length ? Math.min(...listStock) : 0; // mencari stok paling kecil
      pack.price = pack.price.value;

      return pack;
    });
  };

  // exports({
  //   "method":"GET",
  //   "data":null,
  //   "filter":{
  //     "id":"612ee732a65d0d1b65e40353"
  //   }
  // })

  const GET = async () => {
    if (!payload.filter.id) throw new Error("E20092BE");

    // default filter
    payload.filter.license = BSON.ObjectId(license.toString());
    payload.filter._id = BSON.ObjectId(payload.filter.id.toString());
    delete payload.filter.id;

    const [packageDetail] = await dbGetPackageDetail(payload);

    return buildResponseGetDetail(packageDetail);
  };

  const ACTIVE = async () => {
    /*
      Request :
      {"method":"ACTIVE","data":{"active":true},"filter":{"id":"60fa6bf0140f91c490b267e8","outlet_id":"60ebfc1d5571454505b9f0dd"}}
    */
    /*
      1. validation
      2. update package status
      3. update package items
    */

    // default filter
    payload.filter.license = BSON.ObjectId(license.toString());

    // payload filter
    payload.filter.outlet = BSON.ObjectId(payload.filter.outlet_id.toString());
    payload.filter._id = BSON.ObjectId(payload.filter.id.toString());
    delete payload.filter.id;
    delete payload.filter.outlet_id;

    // 1. validation
    await validationStatusRequest();

    if (payload.data.active) {
      await validationItemsIsNonactive(payload.filter._id);
    }

    // 2. update package status
    const foundPackage = await dbUpdatePackage();
    if (!foundPackage) {
      // jika return null, artinya id tidak ditemukan di DB
      throw new Error("E30019BE");
    }

    // 3. update package items
    await dbUpdatePackageItemActive(foundPackage.items);

    return payload.filter._id.toString();
  };

  // validasi items ada yang nonactive atau tidak
  const validationItemsIsNonactive = async (packageId) => {
    const itemIsNonactive = await dbValidationItemsIsNonactive(packageId);
    // if (itemIsNonactive.length == 0) {
    //   return;
    // }
    if (itemIsNonactive[0]?.items_is_nonactive) throw new Error("E30027BE");
  };

  /*
    exports({
      method: 'LITE',
      filter: {
        business_id: 'string',
        outlet_id: 'string'
      }
    })

    1. validation
    2. query package
    3. construct response
  */
  const LITE = async () => {
    // 1. validation
    await LITEValidation();

    // 2. query package
    const packages = await dbLITEGetPackage();

    // 3. construct response
    return packages.map(({ _id: package_id, ...currentPackage }) => {
      return {
        ...currentPackage,
        id: package_id.toString(),
      };
    });
  };

  // Helper function
  const validationStatusRequest = async () => {
    await valid.hasPermission(["bo_product"]);
    if (!payload.filter) throw new Error("E20037BE");
    if (!payload.filter.outlet) throw new Error("E20033BE");
    if (!payload.filter._id) throw new Error("E20047BE");
  };

  const validateGetList = async (filter) => {
    if (!(await valid.hasPermission(["bo_product"], false))) {
      return [];
    }

    // payload filter
    if (!filter.business_id) {
      throw new Error("E20110BE");
    }

    let outlet_in_bussiness = await context.functions.execute(
      "intOutletsFromBusiness",
      filter.business_id
    );
    delete filter.business_id;

    if (filter.outlet_id) {
      const outletId = outlet_in_bussiness.find(
        (v) => v.toString() == filter.outlet_id.toString()
      );

      if (!outletId) throw new Error("E30032BE");

      filter.outlet = BSON.ObjectId(outletId.toString());
    } else {
      filter.outlet = { $in: outlet_in_bussiness };
    }
    delete filter.outlet_id;
  };

  const buildResponseGetDetail = (packageDetail) => {
    packageDetail.items = packageDetail.items.map(
      ({ _id: item_id, label, max, min, products }) => {
        return {
          id: item_id.toString(),
          label,
          max,
          min,
          products: products.map((product) => {
            return {
              id: product._id.toString(),
              name: product.name,
            };
          }),
        };
      }
    );

    packageDetail.prices = packageDetail.prices.map(
      ({ _id: price_id, value, price_level: [pl] }) => {
        return {
          id: price_id.toString(),
          value,
          price_level_id: pl._id.toString(),
          price_level_name: pl.name,
          price_level_default: pl.default,
        };
      }
    );
    packageDetail.prices.sort(
      (x, y) => y.price_level_default - x.price_level_default
    );

    delete packageDetail.product_department;
    return packageDetail;
  };

  const LITEValidation = async () => {
    valid.isObjValid(payload, "filter", "E20037BE", true);

    const { filter } = payload;
    valid.isObjValid(filter, "outlet_id", "E20033BE", true);
    valid.isObjValid(filter, "business_id", "E20110BE", true);

    // mendapatkan list outlet dari schema business
    const outletInBusiness = await context.functions.execute(
      "intOutletsFromBusiness",
      filter.business_id
    );

    const outletId = outletInBusiness.find(
      (v) => v.toString() == filter.outlet_id.toString()
    );
    if (!outletId) throw new Error("E30032BE");
  };

  // Database query
  const dbGetPackageDetail = (payload) => {
    return db
      .collection(collectionNames.product_package)
      .aggregate([
        {
          $match: payload.filter,
        },
        {
          $unwind: "$product_department",
        },
        {
          $lookup: {
            from: "product_prices",
            let: { prices: "$prices" },
            pipeline: [
              { $match: { $expr: { $in: ["$_id", "$$prices"] } } },
              {
                $lookup: {
                  from: "price_levels",
                  localField: "price_level",
                  foreignField: "_id",
                  as: "price_level",
                },
              },
              {
                $project: {
                  _id: 1,
                  value: 1,
                  price_level: {
                    _id: 1,
                    name: 1,
                    default: 1,
                  },
                },
              },
            ],
            as: "prices",
          },
        },
        {
          $lookup: {
            from: "product_package_item",
            let: { items: "$items" },
            pipeline: [
              {
                $match: { $expr: { $in: ["$_id", "$$items"] } },
              },
              {
                $lookup: {
                  from: "products",
                  let: { products: "$products" },
                  pipeline: [
                    {
                      $match: { $expr: { $in: ["$_id", "$$products"] } },
                    },
                    {
                      $project: {
                        _id: 1,
                        name: 1,
                      },
                    },
                  ],
                  as: "products",
                },
              },
              {
                $project: {
                  _id: 1,
                  label: 1,
                  min: 1,
                  max: 1,
                  products: { _id: 1, name: 1 },
                },
              },
            ],
            as: "items",
          },
        },
        {
          $lookup: {
            from: "outlet",
            localField: "outlet",
            foreignField: "_id",
            as: "outlet",
          },
        },
        {
          $unwind: "$outlet",
        },
        {
          $project: {
            id: { $toString: "$_id" },
            _id: 0,
            name: 1,
            sku: 1,
            outlet_id: { $toString: "$outlet._id" },
            outlet_name: { $toString: "$outlet.name" },
            business_id: { $toString: "$outlet.business_id" },
            has_stock: 1,
            //stocks: 1,
            type: 1,
            items: {
              _id: 1,
              label: 1,
              min: 1,
              max: 1,
              products: { _id: 1, name: 1 },
            },
            prices: {
              _id: 1,
              value: 1,
              price_level: {
                _id: 1,
                name: 1,
                default: 1,
              },
            },
            include_tax: 1,
            active: 1,
            sold_out: 1,
            image_url: 1,
          },
        },
      ])
      .toArray();
  };

  const dbUpdatePackage = async () => {
    const {
      data: { active },
      filter,
    } = payload;
    return db.collection(collectionNames.product_package).findOneAndUpdate(
      { ...filter },
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(_id),

          active,
        },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1, items: 1 },
      }
    );
  };

  const dbUpdatePackageItemActive = async (items) => {
    const {
      data: { active: package_active },
      filter: { outlet },
    } = payload;
    return db.collection(collectionNames.product_package_item).updateMany(
      { license, outlet, _id: { $in: items } },
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(_id),

          package_active,
        },
        $inc: { __v: 1 },
      }
    );
  };

  const dbLISTGetPackage = ({ filter }) => {
    return db
      .collection(collectionNames.product_package)
      .aggregate([
        {
          $match: {
            ...filter,
            license: BSON.ObjectId(license.toString()),
          },
        },
        {
          $lookup: {
            from: "product_package_item",
            let: { items: "$items" },
            pipeline: [
              { $match: { $expr: { $in: ["$_id", "$$items"] } } },
              {
                $lookup: {
                  from: "products",
                  let: { products: "$products" },
                  pipeline: [
                    { $match: { $expr: { $in: ["$_id", "$$products"] } } },
                    {
                      $lookup: {
                        from: "product_stock",
                        let: { stocks: "$stocks" },
                        pipeline: [
                          {
                            $match: { $expr: { $in: ["$_id", "$$stocks"] } },
                          },
                        ],
                        as: "stocks",
                      },
                    },
                    { $unwind: "$stocks" },
                  ],
                  as: "products",
                },
              },
              {
                $project: {
                  _id: 1,
                  label: 1,
                  max: 1,
                  min: 1,
                  products: {
                    _id: 1,
                    name: 1,
                    has_stock: 1,
                    stocks: { quantity: 1 },
                  },
                },
              },
            ],
            as: "items",
          },
        },
        {
          $lookup: {
            from: "price_levels",
            let: { outlet_id: "$outlet" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$outlet", "$$outlet_id"] },
                      { $eq: ["$default", true] },
                    ],
                  },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: "level",
          },
        },
        {
          $unwind: "$level",
        },
        {
          $lookup: {
            from: "product_prices",
            let: { prices: "$prices", pl: "$level._id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $in: ["$_id", "$$prices"] },
                      { $eq: ["$$pl", "$price_level"] },
                    ],
                  },
                },
              },
              { $project: { value: 1 } },
            ],
            as: "price",
          },
        },
        {
          $unwind: "$price",
        },
        {
          $lookup: {
            from: "outlet",
            localField: "outlet",
            foreignField: "_id",
            as: "outlet",
          },
        },
        {
          $unwind: "$outlet",
        },
        {
          $project: {
            id: { $toString: "$_id" },
            _id: 0,
            name: 1,
            active: 1,
            sku: 1,
            type: 1,
            sold_out: 1,
            outlet_id: { $toString: "$outlet._id" },
            outlet_name: { $toString: "$outlet.name" },
            price: {
              value: 1,
            },
            items: {
              _id: 1,
              label: 1,
              max: 1,
              min: 1,
              products: {
                _id: 1,
                name: 1,
                has_stock: 1,
                stocks: 1,
              },
            },
            lowerName: {
              $toLower: "$name",
            },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();
  };

  const dbLITEGetPackage = async () => {
    const {
      filter: { outlet_id },
    } = payload;

    const filter = {
      license,
      active: true,
      outlet: BSON.ObjectId(outlet_id.toString()),
    };

    return db
      .collection(collectionNames.product_package)
      .find(filter, { name: 1 })
      .toArray();
  };

  const dbValidationItemsIsNonactive = async (packageId) => {
    return db
      .collection(collectionNames.product_package)
      .aggregate([
        {
          $match: { _id: packageId, license },
        },
        {
          $lookup: {
            from: "product_package_item",
            let: { items: "$items" },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", "$$items"] },
                },
              },
              {
                $project: {
                  _id: 1,
                  products: 1,
                },
              },
            ],
            as: "items",
          },
        },
        // stop aggregate when items is empty
        {
          $match: {
            items: { $ne: [] },
          },
        },
        {
          $lookup: {
            from: "products",
            let: { products_id: { $first: "$items.products" } },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ["$_id", "$$products_id"] },
                },
              },
              {
                $lookup: {
                  from: "product_departments",
                  let: { product_department: "$product_department" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$product_department"] },
                      },
                    },
                    {
                      $lookup: {
                        from: "product_groups",
                        let: { product_group: "$product_group" },
                        pipeline: [
                          {
                            $match: {
                              $expr: { $eq: ["$_id", "$$product_group"] },
                            },
                          },
                          {
                            $project: {
                              _id: 1,
                              active: 1,
                            },
                          },
                        ],
                        as: "group",
                      },
                    },
                    {
                      $project: {
                        _id: 1,
                        active: 1,
                        group: {
                          _id: 1,
                          active: 1,
                        },
                      },
                    },
                    {
                      $addFields: {
                        status_group: { $first: "$group.active" },
                      },
                    },
                  ],
                  as: "department",
                },
              },
              {
                $addFields: {
                  department_active: { $first: "$department.active" },
                  group_active: { $first: "$department.status_group" },
                },
              },
            ],
            as: "products",
          },
        },
        {
          $addFields: {
            status_active: {
              $concatArrays: [
                "$products.active",
                "$products.department_active",
                "$products.group_active",
              ],
            },
          },
        },
        {
          $addFields: {
            items_is_nonactive: { $in: [false, "$status_active"] },
          },
        },
        {
          $project: {
            _id: 0,
            items_is_nonactive: 1,
          },
        },
      ])
      .toArray();
  };

  return Object.freeze({ POST, LIST, GET, ACTIVE, LITE });
};
