exports = async (payload) => {
  try {
    const productObject = await product(payload);
    if (!productObject[payload.method])
      throw new Error("Method not found in request");
    return await productObject[payload.method]();
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientProduct"
    );
  }
};

const product = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const db_views = mongodb.db("VIEWS_DB");
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const { license, _id } = context.functions.execute("intUserContext");

  /*
    exports({
      "method":"LITE_LIST",
      "data":null,
      "filter":{
        "outlet_id":"string",
        "search_text":"Fanta",
        "group": ObjectId,
        "department": ObjectId,
        "limit":25,
        "page":1
        show_variant: true, //default false
      }
    })

    1. validation
    2. dbListProduct
    3. build response
  */
  const LITE_LIST = async () => {
    // 1. validation
    LITEvalidation();
    // 2. get product list
    const listProduct = await dbLITEProduct();

    // 3. build response
    return LITEbuildResponse(listProduct);
  };

  /*
    exports({
      "method":"SEARCH",
      "data":null,
      "filter":{
        "sort_by":"name",
        "sort_type":"1 | -1",
        "business_id":"60d586a6c6fe46d1d1855352",
        "outlet_id":"",
        "search_text":"Fanta",
        "limit":25,
        "page":1,
      }
    })
  */
  const SEARCH = async () => {
    // 1. validation
    SEARCHvalidation();

    // 2. get product list
    const listProduct = await dbListProduct();

    // 3. build response
    return LISTbuildResponse(listProduct);
  };

  /*
    1. validation
    2. get product list
    3. build response

    exports({
      method: 'LIST',
      filter: {
        outlet_id: 'string [OUTLET_ID]',
        active: boolean,
        page: number,
        limit: number
      }
    })
  */
  const LIST = async () => {
    // 1. validation
    LISTvalidation();

    // 2. get product list
    const listProduct = await dbListProduct();
    // return "selesai"
    // 3. build response
    return LISTbuildResponse(listProduct);
  };

  /*
    {
      "method":"POST",
      "data":{
        "id":"",
        "active":true,
        "description":"",
        "has_stock":false,
        "image_url":"",
        "include_tax":false,
        "sold_out":false,
        "name":"asda",
        "outlet_id":"611e1583f7bf5674c1785822",
        "prices":[
          {
            "id":"616504b51d70dbc46e9f9eaa",
            "value":"121231231",
            "price_level_name":"Normal",
            "price_level_id":"611e1583f7bf5674c1785833",
            "default":true
          }
        ],
        "product_department":"611e158f8837424e2499d816",
        "sku":"4324234",
        "tax_exempt":[]
      },
      "filter":{}
    }
  */
  /*
    1. validate request

    new product
    2. save price level
    3. save price
    4. save product

    update product
    2. get old data
    3. handle price level
    4. handle price
    5. update product
  */
  const POST = async () => {
    // 1. validate request
    await putValidation();

    // default data for save
    payload.temp = {
      _partition: payload.data.outlet.toString(),
      __v: 0,
      active: true,
      group_active: true,
      department_active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: BSON.ObjectId(_id.toString()),
      updatedBy: BSON.ObjectId(_id.toString()),
      license,
      outlet: payload.data.outlet,
      user_id: BSON.ObjectId(_id.toString()),
    };

    if (payload.data.id) {
      // update data
      // 2. get old data
      await dbGetExistingProduct();
      // 3. validate stock
      validateStock();
      // 4. delete unused price
      await handleDeletedPrice();
      // 5. delete unused image
      await handleDeleteImage();
    }

    // 2. save price
    payload.data.prices = await handlePrices();
    // 3. save product
    const product_id = await handleSaveProduct();

    await dbUpdateProdQtyInDept();

    await createRecapStock(product_id);

    await generateViewProducts(payload.data)

    return product_id;
  };

  // 1. validate ACL
  // 2. validate request
  // 3. validate with databse
  const putValidation = async () => {
    // 1. validate ACL
    await valid.hasPermission("bo_product");

    if (payload.data.id) {
      payload.data.id = BSON.ObjectId(payload.data.id);
    }

    payload.data.product_department = BSON.ObjectId(
      payload.data.product_department.toString()
    );
    payload.data.outlet = BSON.ObjectId(payload.data.outlet_id.toString());

    if (!payload.filter) payload.filter = {};
    payload.filter.outlet = BSON.ObjectId(payload.data.outlet_id.toString());
    payload.filter.id = payload.data.id;

    // 2. validate request
    putValPurePayload();
    // 3. validate with database
    await putValWithDatabase();
  };

  const putValPurePayload = () => {
    valid.isObjValid(payload.data, "id", "E20092BE", false);
    valid.isObjValid(payload.data, "sold_out", "E20138BE", true);
    valid.isObjValid(payload.data, "active", "E20062BE", true);
    valid.isObjValid(payload.data, "description", "E20063BE", false);
    valid.isObjValid(payload.data, "has_stock", "E20064BE", true);
    valid.isObjValid(payload.data, "include_tax", "E20093BE", true);
    valid.isObjValid(payload.data, "name", "E20094BE", true);
    valid.isObjValid(payload.data, "outlet_id", "E20033BE", true);
    valid.isObjValid(payload.data, "prices", "E20041BE", true);
    valid.isObjValid(payload.data, "product_department", "E20070BE", true);

    if (payload.data.name && payload.data.name.length > 30) {
      throw new Error("E20014BE");
    }
  };

  // 1. validate product id on update state
  // 2. validate unique data
  // 3. validate outlet
  // 4. validate price level
  // 5. validate tax exempt
  // 6. validate department
  const putValWithDatabase = async () => {
    // 1. validate product id on update state
    if (payload.data.id) {
      await valid.isDataExists(
        collectionNames.products,
        {
          _id: payload.data.id,
          outlet: payload.data.outlet,
        },
        "E30042BE"
      );
    }
    // 2. validate unique data
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
      "E30083BE"
    );
    await valid.isUnique(
      payload.data,
      collectionNames.product_package,
      "name",
      "E30048BE"
    );
    await valid.isUnique(
      payload.data,
      collectionNames.product_package,
      "sku",
      "E30048BE"
    );
    await valid.isUnique(
      payload.data,
      collectionNames.product_menu_variant,
      "name",
      "E30130BE"
    );
    // 3. validate outlet
    await valid.isDataExists(
      collectionNames.outlet,
      {
        _id: payload.data.outlet,
      },
      "E30032BE"
    );

    // 4. validate price level
    // get default price level
    await putValPriceLevel();
    // ------------- akhir validasi price level
    // 5. validate tax exempt
    const taxes_id = payload.data.tax_exempt.map((item) => BSON.ObjectId(item));

    const findTaxes = await db
      .collection(collectionNames.taxes)
      .find({ _id: { $in: taxes_id }, license })
      .toArray();

    if (taxes_id.length !== findTaxes.length) {
      throw new Error("E30040BE");
    }

    payload.data.tax_exempt = payload.data.tax_exempt.map((tax) => {
      return BSON.ObjectId(tax.toString());
    });
    // -------------- akhir validasi tax exempt

    // 6. validate department
    const dept = await dbPOSTIsDeptGroupActive();
    if (dept.length === 0) {
      throw new Error("E30049BE");
    }
    if (!payload.data.id) {
      if (!dept[0].active) {
        throw new Error("E30061BE");
      }

      if (!dept[0].group.active) {
        throw new Error("E30060BE");
      }
    }
    // -------------- akhir validasi department

    // validasi product is under package or not
    // jika product update active=false
    // dan status `active` sebelumnya adalah true
    // dan product tersebut adalah bagian dari package
    // maka product tersebut tidak bisa di deactivate
    await isAbleToDeactivate();
  };

  const putValPriceLevel = async () => {
    const {
      data: { outlet },
    } = payload;

    payload.defPL = await db
      .collection(collectionNames.price_levels)
      .findOne({ license, outlet, default: true }, { _id: 1, name: 1 });

    if (!payload.defPL) {
      throw new Error(
        `license ${license}, ` +
        `outlet: ${outlet} tidak memiliki default price levels`
      );
    }

    // mendapatkan default price level dari payload
    const indexOfdefPL = payload.data.prices.findIndex((price) => {
      return price.price_level_id.toString() === payload.defPL._id.toString();
    });
    // jika default price level tidak dikirim, return error server
    // kirim error ke webhook, ada kesalahan code tidak kirim default price level
    if (indexOfdefPL === -1) {
      throw new Error(
        `license ${license}, ` +
        `outlet: ${outlet}, tambah product tidak mengirim default price level`
      );
    }

    if (payload.data.prices.length > 1) {
      // validasi nama price level, tidak boleh ada yang sama
      const list_prices = payload.data.prices.map((v) => {
        return {
          id: v.price_level_id.toString(),
          name: v.price_level_name.toLowerCase(),
        };
      });

      const get_list_price = await db
        .collection(collectionNames.price_levels)
        .find(
          {
            outlet: BSON.ObjectId(outlet.toString()),
            license,
          },
          {
            _id: 1,
            name: 1,
          }
        )
        .toArray();

      get_list_price.forEach((v) => {
        if (
          list_prices.find(
            (el) =>
              el.id !== v._id.toString() && el.name === v.name.toLowerCase()
          )
        ) {
          throw new Error("E30014BE");
        }
      });
    }
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

  const _handlePriceLevel = (price) => {
    const priceLevelId = price.price_level_id
      ? new BSON.ObjectId(price.price_level_id)
      : new BSON.ObjectId();
    let insertQuery = null;
    if (!price.price_level_id) {
      insertQuery = {
        insertOne: {
          document: {
            ...payload.temp,
            _id: priceLevelId,
            name: price.price_level_name,
            default: false,
          },
        },
      };
    }

    return {
      id: priceLevelId,
      insertQuery,
    };
  };

  // 1. save price
  // 2. call handle price level
  const handlePrices = async () => {
    const priceColl = await db.collection(collectionNames.product_prices);
    const priceLevelColl = await db.collection(collectionNames.price_levels);

    const isDuplicate = findDuplicatePriceLevel(payload.data.prices);

    if (isDuplicate) {
      throw new Error("E30099BE");
    }

    let updatedId = [];
    let pricesUpdateQuery = [];
    let priceLevelInsertQuery = [];
    const priceTosave = await payload.data.prices.reduce(
      async (prev, price) => {
        const priceLevel = _handlePriceLevel(price);
        if (priceLevel.insertQuery) {
          priceLevelInsertQuery.push(priceLevel.insertQuery);
        }

        if (price.id) {
          price.id = BSON.ObjectId(price.id.toString());

          // update price
          pricesUpdateQuery.push({
            updateOne: {
              filter: {
                license,
                _id: price.id,
              },
              update: {
                $set: {
                  price_level: priceLevel.id,
                  value: parseFloat(price.value),
                },
                $inc: { __v: 1 },
              },
            },
          });

          updatedId.push(price.id);
          return [...(await prev)];
        } else {
          // new price
          return [
            ...(await prev),
            {
              ...payload.temp,

              _id: new BSON.ObjectId(),
              price_level: priceLevel.id,
              value: parseFloat(price.value),
            },
          ];
        }
      },
      Promise.resolve([])
    );
    // save priceLevels
    if (priceLevelInsertQuery.length > 0) {
      await priceLevelColl.bulkWrite(priceLevelInsertQuery);
    }

    // updatePrice
    if (pricesUpdateQuery.length > 0) {
      await priceColl.bulkWrite(pricesUpdateQuery);
    }

    // hanya menyimpan price baru
    if (priceTosave.length > 0) {
      const savedId = await priceColl.insertMany(priceTosave);
      updatedId = [...updatedId, ...savedId.insertedIds];
    }

    // id dari updated data dan inserted data di gabungkan untuk di simpan di transaksi
    return updatedId;
  };

  // validasi produk ada di promo active atau tidak
  const validationProductAvailability = async (productid) => {
    const itemInPromo = await context.functions.execute(
      "intProductAvailability",
      productid
    );
    if (itemInPromo) throw new Error("E30066BE");
  };

  // handle save product
  const handleSaveProduct = async () => {
    let {
      data: {
        id,
        name,
        active,
        description,
        has_stock,
        image_url,
        include_tax,
        prices,
        product_department,
        sku,
        tax_exempt,
        menu_variant,
        outlet,
        sold_out,
      },
    } = payload;

    const dataToUpdate = {
      name,
      active,
      has_stock,
      description,
      sold_out,
      image_url: image_url || "",
      include_tax,
      prices,
      product_department,
      sku: sku || "",
      tax_exempt: tax_exempt || [],
    };

    const dataToSave = {
      ...payload.temp,

      _id: new BSON.ObjectId(),
      barcode_id: "",
      decimal_qty: false,
      gained_point: 0,
      redeem_point: 0,
      seafood_type: false,
      stocks: [],
      print: [],

      ...dataToUpdate,
    };

    if (menu_variant) dataToSave.menu_variant = menu_variant;

    if (id) {
      if (!active || sold_out) {
        await validationProductAvailability(id);
      }
      const product_id = BSON.ObjectId(id.toString());
      await db.collection(collectionNames.products).updateOne(
        { license, outlet, _id: product_id },
        {
          $set: dataToUpdate,
          $inc: { __v: 1 },
        }
      );

      return product_id;
    } else {
      // Handle product_stocks
      dataToSave.stocks = [await handleDefaultStock()];

      return (
        await db.collection(collectionNames.products).insertOne(dataToSave)
      ).insertedId;
    }
  };

  const createRecapStock = async (product_id) => {
    // jika create baru - > cek apakah payload.data.has_stock: true
    // jika has_stock true -> create product_stock_recap dg stock ambil dari productstock
    // jika update datas -> cek apakah stock sebelumnya false dan stock payload = true
    // jika true -> create product_stock_recap dg stock ambil dari productstock
    // jika update data -> cek apakah stock sebelumnya true dan stock payload = false
    // maka create product stock dg stock_active off

    const {
      data: { id, outlet },
    } = payload;

    if (
      (id && !payload.product?.has_stock && payload.data.has_stock == true) ||
      (payload.product?.has_stock && !payload.data.has_stock) ||
      (!id && payload.data.has_stock == true)
    ) {
      let stockRecap = {
        __v: 0,
        _id: new BSON.ObjectId(),
        _partition: outlet.toString(),
        license: BSON.ObjectId(license.toString()),
        outlet: BSON.ObjectId(outlet.toString()),
        product_id: BSON.ObjectId(product_id.toString()),
        stock_active: payload.data.has_stock ? "on" : "off",
        stock_current: parseFloat(0),
        stock_before: parseFloat(0),
        createdAt: new Date(),
      };

      if (id) {
        const { stock } = payload.product;

        stockRecap = {
          ...stockRecap,
          product_id: BSON.ObjectId(id.toString()),
          stock_current: stock.quantity,
          stock_before: stock.quantity,
        };
      }
      // create product_stock_recap
      await db
        .collection(collectionNames.product_stock_recap)
        .insertOne(stockRecap);
    }

    // after lunch test
    // 0. push realm
    // 1. test validasi saat menonaktifkan stock -> harusnya error saat tidak adjust ke 0
    // 2. test insert product dan create recap on stock aktif
  };

  const handleDefaultStock = async () => {
    return (
      await db.collection(collectionNames.product_stock).insertOne({
        _id: new BSON.ObjectId(),
        _partition: payload.data.outlet.toString(),
        __v: 0,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: BSON.ObjectId(_id.toString()),
        updatedBy: BSON.ObjectId(_id.toString()),
        license,
        outlet: payload.data.outlet,
        quantity: parseFloat(0),
        unit: "0",
        user_id: BSON.ObjectId(_id.toString()),
      })
    ).insertedId;
  };

  // find deleted prices
  const handleDeletedPrice = async () => {
    const { prices: oldPrices } = payload.product;
    const { prices: newPrices } = payload.data;

    const deletedPrices = oldPrices.reduce((prev, price_id) => {
      if (
        newPrices.findIndex(
          (price) => price.id.toString() === price_id.toString()
        ) == -1
      ) {
        return [...prev, BSON.ObjectId(price_id.toString())];
      }
      return [...prev];
    }, []);

    if (deletedPrices.length > 0) {
      await db
        .collection(collectionNames.product_prices)
        .deleteMany({ _id: { $in: deletedPrices } });
    }
  };

  const handleDeleteImage = async () => {
    const { data, product } = payload;
    if (
      product.image_url &&
      (data.image_url || data.image_url === "") &&
      product.image_url !== data.image_url
    ) {
      await context.functions.execute("intRemoveImage", {
        image_url: product.image_url,
      });
    }
  };

  /*
    exports({
      method: 'ACTIVE',
      data: {
        active: true
      },
      filter: {
        id: '6020c9292f23ff5b4b396e35'
      }
    })

    1. validation
    2. update product
    3. Handle product quantity update in dept
  */
  const ACTIVE = async () => {
    // 1. validation
    await ACTIVEValidation();

    // 2. update product
    if (!(await updateActiveProduct())) {
      // jika return null, artinya id tidak ditemukan di DB
      throw new Error("E30042BE");
    }

    await handleProdQtyInDept();

    await generateViewProducts({ outlet: BSON.ObjectId(payload.filter.outlet_id.toString()) })

    return payload.filter.id.toString();
  };

  /*
    exports({
      method: 'GET',
      filter: {
        id: 'PRODUCT_ID'
      }
    })
  */
  const GET = async () => {
    // validation
    if (!payload.filter.id) throw new Error("E20092BE");

    // default filter
    payload.filter.license = BSON.ObjectId(license.toString());
    payload.filter._id = BSON.ObjectId(payload.filter.id.toString());
    delete payload.filter.id;

    const productDetail = await db
      .collection(collectionNames.products)
      .aggregate([
        { $match: payload.filter },
        {
          $lookup: {
            from: "product_departments",
            localField: "product_department",
            foreignField: "_id",
            as: "department",
          },
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
            ],
            as: "prices",
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
            _id: 1,
            sku: 1,
            name: 1,
            has_stock: 1,
            image_url: 1,
            include_tax: 1,
            outlet: { _id: 1, name: 1, business_id: 1 },
            tax_exempt: 1,
            description: 1,
            active: 1,
            sold_out: 1,
            department: {
              _id: 1,
              name: 1,
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
          },
        },
        {
          $sort: { name: 1 },
        },
      ])
      .toArray();

    let dataToResponse = null;
    if (productDetail.length > 0) {
      dataToResponse = {
        ...productDetail[0],
      };

      dataToResponse.id = dataToResponse._id.toString();
      dataToResponse.business_id = dataToResponse.outlet.business_id.toString();
      dataToResponse.outlet_id = dataToResponse.outlet._id.toString();
      dataToResponse.outlet_name = dataToResponse.outlet.name;
      delete dataToResponse._id;
      delete dataToResponse.outlet;

      const [dept] = dataToResponse.department;
      dataToResponse.department_id = dept._id.toString();
      dataToResponse.department_name = dept.name;
      delete dataToResponse.department;

      dataToResponse.prices = dataToResponse.prices.map(
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
      dataToResponse.prices.sort(
        (x, y) => y.price_level_default - x.price_level_default
      );
    }

    return dataToResponse;
  };

  // Helper function ==================
  const ACTIVEValidation = async () => {
    const { filter, data } = payload;
    filter.outlet = BSON.ObjectId(payload.filter.outlet_id);
    filter.id = BSON.ObjectId(payload.filter.id);

    if (!data.active) {
      await validationProductAvailability(payload.filter.id);
    }

    await valid.hasPermission("bo_product");
    valid.isObjValid(filter, "id", "E20092BE", true);
    valid.isObjValid(data, "active", "E20062BE", true);
    valid.isObjValid(filter, "outlet_id", "E20033BE", true);

    // validasi product is under package or not
    // jika product update active=false
    // dan status `active` sebelumnya adalah true
    // dan product tersebut adalah bagian dari package
    // maka product tersebut tidak bisa di deactivate
    await isAbleToDeactivate();
  };

  const isAbleToDeactivate = async () => {
    const { data, filter } = payload;
    if (filter.id) {
      // cari package item dengan product id dari payload
      const package_items = await context.functions.execute(
        "intProductPartOfPackageItem",
        [filter.id]
      );

      // jika di temukan product di pacakge_items
      if (package_items.length > 0) {
        // loop packageitem
        package_items.forEach((item) => {
          // cek apakah old produk di database active tidak sama dengan payload data active
          // cek apakah payload data active = false
          item.products.forEach((eachproduct) => {
            if (data.sold_out) {
              throw new Error("E30133BE");
            }
            if (
              eachproduct._id.toString() == filter.id.toString() &&
              eachproduct.active !== data.active &&
              !data.active
            ) {
              // product tidak bisa di deactive, product di gunakan di package
              throw new Error("E30062BE");
            }
          });
        });
      }
    }
  };

  const handleProdQtyInDept = async () => {
    const { product_department } = await dbFindThisDept();
    payload.data.product_department = product_department;
    await dbUpdateProdQtyInDept();
  };

  const LISTvalidation = () => {
    // validation
    valid.isRequired(payload, "filter", "E20037BE");

    let { filter } = payload;

    valid.isRequired(filter, "limit", "E20109BE");
    valid.isRequired(filter, "page", "E20109BE");
    valid.isRequired(filter, "business_id", "E20110BE");
  };

  const LISTbuildResponse = ({ products, totalData }) => {
    const {
      filter: { limit, page },
    } = payload;

    if (totalData == 0) {
      return {
        totalData: 0,
        page: 1,
        totalPage: 0,
        data: [],
      };
    }

    return {
      totalData,
      page,
      totalPage: Math.ceil(Number(totalData) / Number(limit)),
      data: products,
    };
  };

  const LITEbuildResponse = ([firstValue]) => {
    const {
      filter: { limit, page },
    } = payload;

    if (!firstValue) {
      return {
        totalData: 0,
        page: 1,
        totalPage: 0,
        data: [],
      };
    }
    const { totalData, data } = firstValue;

    return {
      totalData,
      page,
      totalPage: Math.ceil(Number(totalData) / Number(limit)),
      data,
    };
  };

  const SEARCHvalidation = () => {
    LISTvalidation();
  };

  const LITEvalidation = () => {
    // validation
    valid.isRequired(payload, "filter", "E20037BE");

    let { filter } = payload;

    valid.isRequired(filter, "limit", "E20109BE");
    valid.isRequired(filter, "page", "E20109BE");
    valid.isRequired(filter, "outlet_id", "E20033BE");
  };

  // ==================================

  // Database query ===================
  const dbPOSTIsDeptGroupActive = () => {
    const {
      data: { product_department, outlet },
    } = payload;
    return db
      .collection(collectionNames.product_departments)
      .aggregate([
        {
          $match: {
            license,
            outlet,
            _id: product_department,
          },
        },
        {
          $lookup: {
            from: "product_groups",
            localField: "product_group",
            foreignField: "_id",
            as: "group",
          },
        },
        {
          $project: {
            active: 1,
            group: {
              active: 1,
            },
          },
        },
        {
          $unwind: "$group",
        },
      ])
      .toArray();
  };

  const dbGetExistingProduct = async () => {
    const {
      data: { outlet, id },
    } = payload;

    const product = await db
      .collection(collectionNames.products)
      .aggregate([
        {
          $match: {
            license,
            outlet,
            _id: id,
          },
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
                  _id: 1,
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
      ])
      .toArray();

    payload.product = product[0];

    payload.data.product_active = payload.product.active;
  };

  const validateStock = () => {
    const { stock, has_stock } = payload.product;
    // kurang, harus cek apakah dia sednag menonaktifkan stock atau stocknya berubah
    // jika stock sebelumnya on kemudian stock dinonaktifkan
    if (has_stock && payload.data.has_stock == false) {
      if (stock?.quantity != 0) {
        throw new Error("E30135BE");
      }
    }
  };

  const updateActiveProduct = async () => {
    const {
      filter: { id, outlet },
      data: { active },
    } = payload;

    const updatedProduct = await db
      .collection(collectionNames.products)
      .findOneAndUpdate(
        {
          license,
          outlet,
          _id: BSON.ObjectId(id.toString()),
        },
        {
          $set: {
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(_id),
            active,
          },
          $inc: { __v: 1 },
        },
        {
          projection: { _id: 1, active: 1 },
        }
      );

    if (updatedProduct) {
      payload.data.product_active = updatedProduct.active;
    }

    return updatedProduct;
  };

  const dbUpdateProdQtyInDept = async () => {
    const {
      data: { active, product_department, product_active },
      filter: { outlet },
    } = payload;

    if (product_active !== active) {
      await db
        .collection(collectionNames.product_departments)
        .updateOne(
          { license, outlet, _id: product_department },
          { $inc: { product_qty: active ? 1 : -1 } }
        );
    }
  };

  const dbFindThisDept = async () => {
    const {
      filter: { outlet, id },
    } = payload;
    return db
      .collection(collectionNames.products)
      .findOne({ license, outlet, _id: id }, { product_department: 1 });
  };

  const dbListProduct = async () => {
    let {
      filter: {
        page,
        limit,
        business_id,
        outlet_id,
        search_text,
        sort_by,
        sort_type,
        ...filter
      },
    } = payload;

    // default filter
    filter.license = BSON.ObjectId(license.toString());
    filter.active = filter.active ?? true;

    // response dari RF ini hanya untuk product, tidak response menu_variant
    filter.menu_variant = { $ne: true };

    let filter_view_2 = {}
    // payload filter
    if (outlet_id) {
      filter.outlet = BSON.ObjectId(outlet_id.toString());
    } else {
      filter.outlet = {
        $in: await context.functions.execute(
          "intOutletsFromBusiness",
          business_id
        ),
      };
    }

    if (search_text) {
      filter["$or"] = [
        { name: { $regex: search_text, $options: "i" } },
        { sku: { $regex: search_text, $options: "i" } },
      ];

      filter_view_2.name = { $regex: search_text, $options: "i" }
      filter_view_2.sku = { $regex: search_text, $options: "i" }
      delete filter.search_text;
    } else {
      delete filter.search_text;
    }

    if (filter.sold_out == null || filter.sold_out == undefined) {
      delete filter.sold_out;
    }

    let filter2 = [{ $match: { $and: [] } }];
    if ((filter.group === "" && filter.departments?.length === 0) || !filter.group && !filter.departments) {
      filter2 = [];
    }

    if (filter.group) {
      filter2[0]["$match"]["$and"].push({
        "group._id": BSON.ObjectId(filter.group),
      });

      filter_view_2.group_id = { "$in": [BSON.ObjectId(filter.group)] }
      delete filter.group;
    } else {
      delete filter.group;
    }

    if (filter.departments?.length > 0) {
      filter2[0]["$match"]["$and"].push({
        "department._id": {
          $in: filter.departments.reduce((prev, next) => {
            return [...prev, BSON.ObjectId(next)];
          }, []),
        },
      });

      filter_view_2.department_id = {
        "$in": filter.departments.reduce((prev, next) => {
          return [...prev, BSON.ObjectId(next)];
        }, [])
      }
      delete filter.departments;
    } else {
      delete filter.departments;
    }

    const lookupDepartment = [
      {
        $lookup: {
          from: "product_departments",
          let: {
            dp: "$product_department",
            license_id: "$license",
            outlet_id: "$outlet",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $eq: ["$license", "$$license_id"],
                    },
                    {
                      $eq: ["$outlet", "$$outlet_id"],
                    },
                    { $eq: ["$_id", "$$dp"] },
                  ],
                },
              },
            },
            {
              $lookup: {
                from: "product_groups",
                let: { pd_group: "$product_group" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ["$license", "$$license_id"],
                          },
                          {
                            $eq: ["$outlet", "$$outlet_id"],
                          },
                          {
                            $eq: ["$_id", "$$pd_group"],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      name: 1,
                    },
                  },
                ],
                as: "product_group",
              },
            },
            {
              $unwind: "$product_group",
            },
            {
              $project: {
                _id: 1,
                name: 1,
                product_group: 1,
              },
            },
          ],
          as: "department",
        },
      },
      {
        $unwind: "$department",
      },
      {
        $addFields: { group: "$department.product_group" },
      },
      {
        $unset: "department.product_group",
      },
    ];

    const productPrice = [
      {
        $lookup: {
          from: "product_prices",
          let: {
            license_id: "$license",
            outlet_id: "$outlet",
            prices: "$prices",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $eq: ["$license", "$$license_id"],
                    },
                    {
                      $eq: ["$outlet", "$$outlet_id"],
                    },
                    {
                      $in: ["$_id", "$$prices"],
                    },
                  ],
                },
              },
            },
            {
              $lookup: {
                from: "price_levels",
                let: {
                  price_level: "$price_level",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ["$license", "$$license_id"],
                          },
                          {
                            $eq: ["$outlet", "$$outlet_id"],
                          },
                          { $eq: ["$_id", "$$price_level"] },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      name: 1,
                      default: 1,
                    },
                  },
                ],
                as: "level",
              },
            },
            {
              $unwind: "$level",
            },
            {
              $project: {
                value: 1,
                default_price: "$level.default",
              },
            },
            {
              $match: {
                default_price: true,
              },
            },
            {
              $unset: "default_price",
            },
          ],
          as: "price",
        },
      },
      {
        $unwind: "$price",
      },
    ];

    const outletQuery = [
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
    ];

    let sort = { $sort: { lowerName: sort_type ?? 1 } };

    // kalau ada payload sort_by harus ada sort_type , kalau tidak sorting akan default
    if (sort_by && sort_type) {
      if (sort_by !== "name") {
        const obj_sort = {};
        obj_sort[sort_by] = sort_type;
        sort = { $sort: obj_sort };
      }
    }
    delete filter.sort_by;
    delete filter.sort_type;

    const products_view = await getViewProducts(filter, filter_view_2, sort, page, limit)

    if (products_view.totalData > 0) {
      return products_view
    }

    const products = await db
      .collection(collectionNames.products)
      .aggregate([
        { $match: filter },
        ...lookupDepartment,
        ...filter2, // filter2
        ...productPrice,
        ...outletQuery,
        {
          $match: { "department.name": { $nin: ["custom", "package"] } },
        },
        {
          $project: {
            id: { $toString: "$_id" },
            _id: 0,
            outlet_id: { $toString: "$outlet._id" },
            outlet_name: "$outlet.name",
            department_id: { $toString: "$department._id" },
            department_name: "$department.name",
            group_id: { $toString: "$group._id" },
            group_name: "$group.name",
            price: "$price.value",
            level: "$price.default_price",

            sku: 1,
            name: 1,
            active: 1,
            lowerName: {
              $toLower: "$name",
            },
          },
        },
        sort,
        {
          $unset: "lowerName",
        },
        { $skip: page > 0 ? (page - 1) * limit : 0 },
        { $limit: limit },
      ])
      .toArray();

    const getTotalData = await db
      .collection(collectionNames.products)
      .aggregate([
        { $match: filter },
        ...lookupDepartment,
        ...filter2,
        { $count: "count" },
      ])
      .toArray();

    await generateViewProducts(filter)
    return {
      products: products,
      totalData: getTotalData[0]?.count || 0,
    };
  };

  const dbLITEProduct = async () => {
    let {
      filter: { page, limit, outlet_id, show_variant, ...params },
    } = payload;

    const filter = {
      // default filter
      // license: BSON.ObjectId(license.toString()),
      active: params.active ?? true,
      outlet_id: BSON.ObjectId(outlet_id.toString()),
    };


    if (params.search_text) {
      filter["$or"] = [
        { name: { $regex: params.search_text, $options: "i" } },
        { sku: { $regex: params.search_text, $options: "i" } },
      ];
    }


    if (params.group) {
      filter["group_id"] = BSON.ObjectId(
        params.group.toString()
      );
    }

    if (params.department) {
      filter["department_id"] = BSON.ObjectId(
        params.department.toString()
      );
    }

    if (!show_variant) {
      filter["menu_variant"] = false
      // if (filter["$or"]) {
      //   filter["$and"] = [
      //     {
      //       $or: filter["$or"],
      //     },
      //     {
      //       $or: [{ menu_variant: null }, { menu_variant: { $exists: false } }],
      //     },
      //   ];
      //   delete filter["$or"];
      // } else {
      //   console.log("masuk sini")
      //   filter["$or"] = [
      //     { menu_variant: null },
      //     { menu_variant: { $exists: false } },
      //   ];
      // }
    }

    let lookupDepartment = [];
    if (params.group || params.department) {
      lookupDepartment = [
        {
          $match: {
            license: filter.license,
            outlet: filter.outlet,
          },
        },
        {
          $lookup: {
            from: "product_departments",
            as: "department",
            let: { dept: "$product_department" },
            pipeline: [
              { $match: { $expr: { $eq: ["$$dept", "$_id"] } } },
              { $project: { _id: 1, product_group: 1 } },
            ],
          },
        },
        {
          $unwind: "$department",
        },
      ];
    }

    const get_view_products = await db_views.collection("view_products").aggregate([
      {
        $facet: {
          data: [
            { $match: filter },
            {
              $project: {
                id: { $toString: "$_id" },
                _id: 0,
                sku: 1,
                name: 1,
                menu_variant: 1,
                // untuk sorting -> aggregate gak suport collation untuk sorting case-insensitive
                lowerName: { $toLower: "$name" },
              },
            },
            {
              $sort: {
                lowerName: 1,
              },
            },
            // remove lowerName, karena hanya digunakan untuk sorting
            {
              $unset: "lowerName",
            },
            { $skip: page > 0 ? (page - 1) * limit : 0 },
            { $limit: limit }
          ],
          totalData: [
            { $match: filter },
            { $count: "count" },
          ]
        }
      }
    ]).toArray();

    get_view_products[0].totalData = get_view_products[0].totalData[0]?.count || 0;
    return get_view_products
    // const products = await db
    //   .collection(collectionNames.products)
    //   .aggregate([
    //     {
    //       $facet: {
    //         data: [
    //           ...lookupDepartment,
    //           { $match: filter },
    //           {
    //             $lookup: {
    //               from: "product_menu_variant",
    //               localField: "menu_variant",
    //               foreignField: "_id",
    //               as: "menu_variant",
    //             },
    //           },
    //           {
    //             $unwind: {
    //               path: "$menu_variant",
    //               preserveNullAndEmptyArrays: true,
    //             },
    //           },
    //           {
    //             $project: {
    //               id: { $toString: "$_id" },
    //               _id: 0,
    //               sku: 1,
    //               name: 1,
    //               menu_variant: {
    //                 active: 1,
    //               },
    //               // untuk sorting -> aggregate gak suport collation untuk sorting case-insensitive
    //               lowerName: { $toLower: "$name" },
    //             },
    //           },
    //           {
    //             $sort: {
    //               lowerName: 1,
    //             },
    //           },
    //           // remove lowerName, karena hanya digunakan untuk sorting
    //           {
    //             $unset: "lowerName",
    //           },
    //           { $skip: page > 0 ? (page - 1) * limit : 0 },
    //           { $limit: limit },
    //         ],
    //         totalData: [
    //           ...lookupDepartment,
    //           { $match: filter },
    //           { $count: "count" },
    //         ],
    //       },
    //     },
    //   ])
    //   .toArray();

    // products[0].totalData = products[0].totalData[0]?.count || 0;
    // return products;
  };
  // ==================================

  const getViewProducts = async (filter, filter_view_2, sort, page, limit) => {
    const { outlet, active, menu_variant } = filter

    const filter_match = {
      active,
      menu_variant,
      outlet_id: outlet,
      ...filter_view_2
    }

    const v_products = await db_views.collection("view_products").aggregate([
      {
        $match: filter_match
      },
      {
        $project: {
          id: { $toString: "$_id" },
          _id: 0,
          outlet_id: { $toString: "$outlet_id" },
          outlet_name: 1,
          department_id: { $toString: "$department_id" },
          department_name: 1,
          group_id: { $toString: "$group_id" },
          group_name: 1,
          price: 1,
          sku: 1,
          name: 1,
          active: 1,
          lowerName: {
            $toLower: "$name",
          },
        },
      },
      sort,
      {
        $unset: "lowerName",
      },
      { $skip: page > 0 ? (page - 1) * limit : 0 },
      { $limit: limit }
    ]).toArray()

    const count_products = await db_views.collection("view_products").count(filter_match)

    return {
      products: v_products,
      totalData: count_products
    }
  }

  const generateViewProducts = async (filter) => {
    const { outlet } = filter
    await context.functions.execute("intGenerateView", { outlet, col_view: "view_products", col_db: "products" })
  }

  return Object.freeze({ LIST, POST, ACTIVE, GET, SEARCH, LITE_LIST });
};
