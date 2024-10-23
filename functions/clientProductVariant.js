exports = async (payload) => {
  try {
    const productVariantObject = await productVariant(payload);
    const { method } = payload;
    if (productVariantObject[method]) {
      return await productVariantObject[method]();
    } else {
      return true;
    }
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "clientProductVariant"
    );
  }
};

const productVariant = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const {
    product_menu_variant,
    products,
    product_package,
    product_departments,
    price_levels,
  } = context.values.get("COLLECTION_NAMES");

  const { _id: user_id, license } = context.functions.execute("intUserContext");

  /*
    {
      "method":"LITE",
      "data":null,
      "filter":{
        "business_id":"611e1583f7bf5674c1785823",
        "outlet_id":"611e1583f7bf5674c1785822"
      }
    }

    1. validation
    2. fetch dept
  */
  const LITE = async () => {
    // 1. validation
    await LITEValidation();

    // 2. fetch dept
    const variants = await dbLITEGetVariant();

    return variants.map(({ _id, name }) => {
      return {
        id: _id.toString(),
        name,
      };
    });
  };

  /*
    exports({
    "method":"LIST",
    "data":null,
    "filter":{"business_id":"611e1583f7bf5674c1785823","outlet_id":""}
    })
  */
  const LIST = async () => {
    // validate ACL tapi tidak perlu throw error
    if (!(await valid.hasPermission(["bo_product"], false))) {
      return [];
    }

    let { filter } = payload;

    if (!filter) {
      filter = {};
    }

    filter.license = license;

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

    const rawData = await db
      .collection(product_menu_variant)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: "outlet",
            localField: "outlet",
            foreignField: "_id",
            as: "outlet",
          },
        },
        {
          $lookup: {
            from: "product_departments",
            localField: "product_department",
            foreignField: "_id",
            as: "department",
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            products: 1,
            active: 1,
            sold_out: 1,
            department: { _id: 1, name: 1 },
            outlet: { _id: 1, name: 1 },
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();

    return rawData.map((v) => {
      const {
        _id,
        name,
        active,
        products: product_list,
        sold_out,
        outlet: [{ _id: outlet_id, name: outlet_name }],
        department: [{ _id: department_id, name: department_name }],
      } = v;

      return {
        id: _id.toString(),
        name,
        active,
        sold_out,
        outlet_id: outlet_id.toString(),
        outlet_name,
        department_id: department_id.toString(),
        department_name,
        total_variants: product_list.length,
      };
    });
  };

  /*
    exports({
      method: 'GET',
      filter: {
        id: "6013b2a5e8151028aab64cc4"
      }
    })
  */
  // 1. nama produk di transform raw (tanpa prefix) sebelum di return
  const GET = async () => {
    // validate ACL
    if (!(await valid.hasPermission(["bo_product"], false))) {
      return {};
    }

    let { filter } = payload;

    filter.license = license;
    filter._id = BSON.ObjectId(filter.id.toString());
    delete filter.id;

    const rawData = await db
      .collection(product_menu_variant)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: "outlet",
            localField: "outlet",
            foreignField: "_id",
            as: "outlets",
          },
        },
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
            from: "user_business",
            let: { outletProduct: "$outlet" },
            pipeline: [
              { $match: { $expr: { $in: ["$$outletProduct", "$outlet"] } } },
            ],
            as: "user_business",
          },
        },
        {
          $lookup: {
            from: "products",
            let: { products: "$products" },
            pipeline: [
              { $match: { $expr: { $in: ["$_id", "$$products"] } } },
              {
                $lookup: {
                  from: "product_prices",
                  let: { prices: "$prices" },
                  pipeline: [
                    { $match: { $expr: { $in: ["$_id", "$$prices"] } } },
                    {
                      $sort: {
                        price_level: 1,
                      },
                    },
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
            ],
            as: "products",
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            active: 1,
            include_tax: 1,
            license: 1,
            outlet: 1,
            products: {
              _id: 1,
              name: 1,
              sku: 1,
              active: 1,
              include_tax: 1,
              prices: {
                _id: 1,
                value: 1,
                price_level: 1,
              },
              has_stock: 1,
              description: 1,
            },
            user_business: { _id: 1, license: 1, name: 1 },
            image_url: 1,
            department: { _id: 1, name: 1 },
            outlets: { _id: 1, name: 1 },
            sold_out: 1,
          },
        },
      ])
      .toArray();

    return rawData.map((v) => {
      const {
        _id,
        name,
        active,
        user_business: [{ _id: business_id }],
        products: product_list,
        image_url,
        sold_out,
        outlets: [{ _id: outlet_id, name: outlet_name }],
        department: [{ _id: department_id, name: department_name }],
      } = v;

      // variable penampung data desc dan stock dari array of products
      const description_has_stock = {
        desc:
          Array.isArray(product_list) && product_list.length > 0
            ? product_list[0].description
            : "",
        has_stock:
          Array.isArray(product_list) && product_list.length > 0
            ? product_list[0].has_stock
            : false,
        include_tax:
          Array.isArray(product_list) && product_list.length > 0
            ? product_list[0].include_tax
            : false,
      };

      // 1. nama produk di transform raw (tanpa prefix) sebelum di return
      let renameProductResult = product_list.map((item) => {
        item.id = item._id.toString();
        item.name = item.name.split(`${name} - `)[1];
        delete item.has_stock;
        delete item.description;
        delete item.include_tax;

        item.prices = item.prices.map(
          ({ _id: price_id, value, price_level: [pl] }) => {
            console.log("pl", JSON.stringify(pl.name));
            return {
              id: price_id.toString(),
              value,
              price_level_id: pl._id.toString(),
              price_level_name: pl.name,
              price_level_default: pl.default,
            };
          }
        );

        delete item._id;
        return item;
      });

      return {
        id: _id.toString(),
        name,
        active,
        business_id: business_id.toString(),
        outlet_id: outlet_id.toString(),
        outlet_name,
        department_id: department_id.toString(),
        department_name,
        variants: renameProductResult,
        image_url,
        sold_out,
        // karena semua sama maka di populasi dari data pertama saja
        description: description_has_stock.desc,
        has_stock: description_has_stock.has_stock,
        include_tax: description_has_stock.include_tax,
      };
    })[0];
  };

  /*
    exports({
      "method":"POST",
      "data":{
        "id":"616534b2be699c90de1f7149",
        "name":"ICE SOUP",
        "product_department":"611e1590f7bf5674c1785952",
        "image_url":"",
        "outlet_id":"611e1583f7bf5674c1785822",
        "variants":[
          {
            "id":"616534b3be699c90de1f7157",
            "name":"Buah",
            "sku":"I1098217318",
            "prices":[
              {
                "id":"",
                "value":"12000",
                "price_level_name":"Normal",
                "price_level_id":"611e1583f7bf5674c1785833",
                "default":true
              }
            ],
            "active":true
          },
          {
            "id":"616534b3be699c90de1f7159",
            "name":"Jelly",
            "sku":"I1098217319",
            "prices":[
              {
                "id":"",
                "value":"12000",
                "price_level_name":"Normal",
                "price_level_id":"611e1583f7bf5674c1785833",
                "default":true
              }
            ],
            "active":true
          }],
        "has_stock":false,
        "include_tax":false,
        "active":true,
        "sold_out": false,
        "description":"ini macam2 soup buah"
      },
      "filter":{}
      }
    )
  */
  // 1. Validation menu_variant data
  // 2. get old data of menu variant
  // 3. first of all save product variant
  // 4. jika proses menyimpan semua product variant sukses, maka simpan menu variantnya
  const POST = async () => {
    let generatedID =
      payload.data.id != ""
        ? BSON.ObjectId(payload.data.id)
        : new BSON.ObjectId();
    // 1. validation menu_variant
    await menuVariantValidator();

    // 2. getOldData of menu variant
    const oldData = await getOldData();

    // 3. save the variant first (product)
    const savingVariant = await handleSaveProduct(oldData, generatedID);
    // 4. jika penyimpanan variant semua sukses, maka simpan menu variantnya
    let errorIndex = savingVariant.findIndex(
      (variant) => variant.status === false
    );

    if (errorIndex === -1) {
      return handleSaveMenuVariant(oldData, generatedID, savingVariant);
    } else {
      // Error variant tidak bisa disimpan
      throw new Error(savingVariant[errorIndex].error);
    }
  };

  /*
    exports({
      method: 'ACTIVE',
      data:{
        active: false
      }
      filter: {
        id: "601a46f5eb72872e8d92118a",
        outlet: "600547cb5009e654231bd9a6"
      }
    })
  */
  const ACTIVE = async () => {
    await valid.hasPermission(["bo_product"]);

    if (!payload.filter.id) {
      throw new Error("E20072BE");
    }

    await validationProductPromo(payload.filter.id);

    // default filter
    payload.filter.license = license;

    // payload filter
    payload.filter.outlet = BSON.ObjectId(payload.filter.outlet.toString());
    payload.filter._id = BSON.ObjectId(payload.filter.id.toString());
    delete payload.filter.id;

    const result = await db.collection(product_menu_variant).findOneAndUpdate(
      { ...payload.filter },
      {
        $set: {
          updatedAt: new Date(),
          updatedBy: BSON.ObjectId(user_id),

          active: payload.data.active,
        },
        $inc: { __v: 1 },
      },
      {
        projection: { _id: 1 },
      }
    );

    if (!result) {
      // jika return null, artinya id tidak ditemukan di DB
      throw new Error("E30044BE");
    }

    return payload.filter._id.toString();
  };

  const checkValidPriceLevels = async () => {
    let old_pricelevels = [];
    payload.data.variants.forEach((variant) => {
      variant.prices.forEach((eachprice) => {
        if (eachprice.price_level_id) {
          let findIndex = old_pricelevels.findIndex(
            (id) => id.toString() === eachprice.price_level_id.toString()
          );

          if (findIndex === -1) {
            old_pricelevels.push(
              BSON.ObjectId(eachprice.price_level_id.toString())
            );
          }
        }

        if (!eachprice.price_level_id) {
          throw new Error("E20222BE");
        }
      });
    });

    const get_list_id = await db
      .collection(price_levels)
      .find(
        {
          _id: { $in: old_pricelevels },
          license,
        },
        {
          _id: 1,
        }
      )
      .toArray();

    if (get_list_id.length !== old_pricelevels.length) {
      throw new Error("E30077BE");
    }
  };

  const menuVariantValidator = async () => {
    payload.filter = {
      // default filter
      license,

      // payload filter
      outlet: BSON.ObjectId(payload.data.outlet_id.toString()),
    };

    if (payload.data.id) {
      payload.filter._id = BSON.ObjectId(payload.data.id.toString());
    }
    // validate ACL
    await valid.hasPermission(["bo_product"]);

    if (payload.data.outlet_id) {
      payload.data.outlet = BSON.ObjectId(payload.data.outlet_id.toString());
      delete payload.data.outlet_id;
    }

    if (payload.data.name && payload.data.name.length > 30) {
      throw new Error("E20014BE");
    }

    valid.isObjValid(payload.data, "name", "E20069BE", true);
    valid.isObjValid(payload.data, "product_department", "E20070BE", true);
    valid.isObjValid(payload.data, "sold_out", "E20138BE", true);

    //dataName untuk mencari duplicate varian name
    const dataName = payload.data.variants.map(({ name }) =>
      name.toLowerCase()
    );

    if (new Set(dataName).size !== dataName.length) throw new Error("E20020BE");

    if (!payload.data.id) {
      await valid.isUnique(
        payload.data,
        product_menu_variant,
        "name",
        "E30045BE"
      );
      await valid.isUnique(payload.data, products, "name", "E30045BE");
      await valid.isUnique(payload.data, product_package, "name", "E30045BE");
    }

    // function untuk ngecek product_dept dan product group
    await validationGroupDepartment(payload.data.product_department);

    // check id pricelevel
    await checkValidPriceLevels();

    await productIsAbleToDeactivate();
  };

  const productIsAbleToDeactivate = async () => {
    const { data } = payload;

    const productsid = data.variants.reduce((prev, product) => {
      if (product.id) {
        return [...prev, product.id];
      }
      return prev;
    }, []);

    const package_items = await context.functions.execute(
      "intProductPartOfPackageItem",
      productsid
    );

    // jika di temukan product di pacakge_items
    if (package_items.length > 0) {
      // loop packageitem
      package_items.forEach((item) => {
        // cek apakah old produk di database active tidak sama dengan payload data active
        // cek apakah payload data active = false
        item.products.forEach((eachproduct) => {
          const findProduct = data.variants.find((product) => {
            return product.id.toString() == eachproduct._id.toString();
          });

          if (
            findProduct &&
            eachproduct.active !== findProduct.active &&
            !findProduct.active
          ) {
            // product tidak bisa di deactive, product di gunakan di package
            throw new Error("E30062BE");
          }
        });
      });
    }
  };

  const validationGroupDepartment = async (dept_id) => {
    const dept = await db
      .collection(product_departments)
      .findOne({ _id: BSON.ObjectId(dept_id.toString()), license });

    if (!dept) throw new Error("E30049BE");
    if (!dept.active || !dept.group_active) throw new Error("E30064BE");
  };

  const variantValidator = async (variants) => {
    const { name, outlet } = payload.data;
    // loop semua variant dan cek semuanya
    const list_variants = await Promise.all(
      variants.map(async (product) => {
        const { name: itemName } = product;

        // check name item variant cant be the same with parent variant
        if (itemName.toLowerCase() === name.toLowerCase())
          throw new Error("E30112BE");

        product.outlet = payload.data.outlet;
        product.name = generateVariantName(product);

        await valid.isObjValid(product, "name", "E20071BE", true);

        return {
          id: !product?.id ? "" : product.id.toString(),
          name: product.name.toLowerCase(),
          sku: product.sku,
        };
      })
    );

    await valid.isUniqueByArray(
      products,
      outlet,
      ["sku", "name"],
      list_variants,
      "E30132BE"
    );

    await valid.isUniqueByArray(
      product_menu_variant,
      outlet,
      ["name"],
      list_variants,
      "E30132BE"
    );

    await valid.isUniqueByArray(
      product_package,
      outlet,
      ["sku", "name"],
      list_variants,
      "E30132BE"
    );
  };

  const getOldData = async () => {
    const { filter } = payload;
    if (filter._id) {
      const oldData = await db
        .collection(product_menu_variant)
        .findOne(
          { ...filter },
          { _id: 1, products: 1, image_url: 1, active: 1 }
        );
      if (!oldData) throw new Error("E30044BE");

      return oldData;
    }

    return false;
  };

  // A. validasi semua product variant
  // B. cek perbedaaan old product variant dan new product variant => jika ada data yang tidak ada, maka product varian dideaktifkan
  // C. masukkan sisa dari diff tersebut seperti biasa
  // 1. restructure data sesuai standard clientProduct
  // 2. dan generate nama sesuai standart (MVname) - (PVname) setiap kali simpan data (update/insert)
  // 3. hit function clientProduct

  const checkVariants = (variants) => {
    return Array.isArray(variants) && variants.length > 0;
  };

  const handleSaveProduct = async (oldVariantData, variantID) => {
    let {
      data: {
        variants,
        sold_out,
        description,
        image_url,
        product_department,
        outlet,
        has_stock,
        include_tax,
        active: isActiveMenuVariant,
      },
    } = payload;

    if (checkVariants(variants)) {
      // A. validasi semua variant namanya sudah terisi dan unik
      await variantValidator(variants);

      // B. cek diff dari old variant dan new variant, jika ada variant yang di hapus, maka deactive kan dari product
      if (oldVariantData && oldVariantData.products.length > 0) {
        let deletedData = [];
        oldVariantData.products.map((oldVariant) => {
          let findIndex = variants.findIndex(
            (newVariant) => newVariant.id.toString() === oldVariant.toString()
          );

          if (findIndex === -1) {
            deletedData.push({
              id: oldVariant,
              outlet,
              active: false,
            });
          }
        });

        if (deletedData.length > 0) {
          await Promise.all(
            deletedData.map(async (product) => {
              return context.functions.execute("clientProduct", {
                method: "ACTIVE",
                data: {
                  active: false,
                },
                filter: {
                  id: product.id,
                  outlet_id: product.outlet,
                },
              });
            })
          );
        }
      }

      const isActiveVariant = (active) => {
        // jika ada perubahan status active pada MV, maka PV mengikuti status active MV
        if (oldVariantData) {
          return oldVariantData.active === isActiveMenuVariant
            ? active
            : isActiveMenuVariant;
        }
        return active;
      };

      // C. sisanya masukkan satu per satu secara normal

      return Promise.all(
        variants.map(async (product) => {
          // jika menuvariant tidak aktif product variant menjadi deactive
          // 1. restructure data as requirement
          let dataToSave = {
            ...product,
            active: isActiveVariant(product.active),
            name: product.name,
            menu_variant: variantID,
            description,
            image_url,
            product_department,
            outlet_id: outlet.toString(),
            has_stock,
            sold_out,
            include_tax,
            tax_exempt: [],
          };

          if (!payload.data.active || !dataToSave.active) {
            await validationProductPromo(dataToSave.id);
          }

          // 2. hit product function to insert/update
          return context.functions.execute("clientProduct", {
            method: "POST",
            data: dataToSave,
          });
        })
      );
    }
  };

  const handleDeleteImage = async (oldData) => {
    const { data } = payload;
    if (
      oldData.image_url &&
      (data.image_url || data.image_url === "") &&
      oldData.image_url !== data.image_url
    ) {
      await context.functions.execute("intRemoveImage", {
        image_url: oldData.image_url,
      });
    }
  };

  const validationProductPromo = async (productID) => {
    if (productID) {
      const collectionNames = context.values.get("COLLECTION_NAMES");
      const productInPromo = await db
        .collection(collectionNames.promo_option)
        .find({ object: new BSON.ObjectId(productID), license, active: true })
        .toArray();
      if (productInPromo?.length > 0) throw new Error("E30066BE");
    }
  };

  const handleSaveMenuVariant = async (oldData, variantID, insertedProduct) => {
    const {
      filter,
      data: { name, sold_out, product_department, image_url, outlet, active },
    } = payload;

    if (oldData) {
      // delete unused image
      await handleDeleteImage(oldData);
      // // update member
      await db.collection(product_menu_variant).updateOne(
        { ...filter },
        {
          $set: {
            user_id: BSON.ObjectId(user_id),
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user_id),

            name,
            product_department: BSON.ObjectId(product_department.toString()),
            image_url,
            outlet: BSON.ObjectId(outlet.toString()),
            products: insertedProduct,
            sold_out,
            active,
          },
          $inc: { __v: 1 },
        }
      );

      return filter._id.toString();
    } else {
      // insert data
      const newData = await db.collection(product_menu_variant).insertOne({
        _id: variantID,
        _partition: filter.outlet.toString(),
        __v: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: BSON.ObjectId(user_id),
        updatedBy: BSON.ObjectId(user_id),
        license: filter.license,
        user_id: BSON.ObjectId(user_id),
        department_active: true,
        group_active: true,

        name,
        product_department: BSON.ObjectId(product_department.toString()),
        image_url,
        outlet: BSON.ObjectId(outlet.toString()),
        products: insertedProduct,
        sold_out,
        active,
      });

      return newData.insertedId.toString();
    }
  };

  const generateVariantName = (product) => {
    return `${payload.data.name} - ${product.name}`;
  };

  // Helper function
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
  const dbLITEGetVariant = async () => {
    const {
      filter: { outlet_id },
    } = payload;

    const filter = {
      license,
      active: true,
      outlet: BSON.ObjectId(outlet_id.toString()),
    };

    return db
      .collection(product_menu_variant)
      .find(filter, { name: 1 })
      .toArray();
  };

  return Object.freeze({ LITE, POST, LIST, ACTIVE, GET });
};
