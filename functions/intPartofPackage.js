module.exports = async (payload) => {
  /*
  exports({
    user_id:"611e15808837424e2499d6b6",
    license:"611e1583cdb6fa7fdcd2bf0b",
    list_product_id:["611e15acd024b14075d60385"]
  })

  */
  try {
    // payload validation
    validation(payload);

    // variable untuk menampung general function
    const destFunction = generalFunction(payload);

    // mencari product yang menjadi part of product ,
    const packages = await destFunction.findProductPartOfPacakage();

    // mengambil paket yang terkena efek perubahan dari products.
    // hanya ambil data yg has_stock dan quantity berubah dari data sebelumnya
    const getDiffPackage = await destFunction.recalculatePackageStock(packages);

    // update data stock paket dari perubahan data products
    return await destFunction.updatePackages(getDiffPackage);
    //return packages
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "intPartofPackage"
    );
  }
};

const validation = ({ user_id, license, list_product_id }) => {
  if (!user_id) throw new Error("E20035BE");
  if (!license) throw new Error("E30007BE");
  if (!list_product_id) throw new Error("E20137BE");
};

const generalFunction = ({ _, license, list_product_id }) => {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const { product_package, product_stock } =
    context.values.get("COLLECTION_NAMES");

  license = BSON.ObjectId(license.toString());

  //formating list product id to ObjectId
  list_product_id = list_product_id.map((id) => BSON.ObjectId(id.toString()));

  const findProductPartOfPacakage = async () => {
    // query product yg menjadi bagian dari product
    let part_of_package = await db
      .collection(product_package)
      .aggregate([
        {
          $match: {
            license,
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
                      $match: {
                        $expr: {
                          $in: ["$_id", "$$products"],
                        },
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
                        as: "product_stocks",
                      },
                    },
                    {
                      $project: {
                        _id: 1,
                        name: 1,
                        has_stock: 1,
                        product_stock: 1,
                        product_stocks: { _id: 1, quantity: 1 },
                      },
                    },
                  ],
                  as: "product_items",
                },
              },
              {
                $project: {
                  _id: 1,
                  label: 1,
                  product_items: {
                    _id: 1,
                    name: 1,
                    has_stock: 1,
                    product_stock: 1,
                    product_stocks: { _id: 1, quantity: 1 },
                  },
                },
              },
            ],
            as: "items",
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
            as: "package_stocks",
          },
        },
        {
          $unwind: "$package_stocks", // sementara di unwind untuk stock package kalau tidak ada stock dengan type unit
        },
        {
          $match: {
            items: {
              $elemMatch: {
                products: {
                  $in: list_product_id,
                },
              },
            },
          },
        },
        {
          $project: {
            _id: 1,
            outlet: 1,
            partition: 1,
            sku: 1,
            name: 1,
            has_stock: 1,
            package_stocks: { _id: 1, quantity: 1 },
            items: {
              _id: 1,
              label: 1,
              product_items: {
                _id: 1,
                name: 1,
                has_stock: 1,
                product_stock: 1,
                product_stocks: { _id: 1, quantity: 1 },
              },
            },
          },
        },
        {
          $group: {
            _id: "$_id",
            name: { $first: "$name" },
            has_stock: { $first: "$has_stock" },
            package_stocks: { $first: "$package_stocks" },
            package_items: { $first: "$items" },
          },
        },
        {
          $sort: { _id: -1 },
        },
      ])
      .toArray();

    // manipulasi data part_of_package sesuaikan dengan format yg lebih bisa di baca
    return part_of_package.map((obj_package) => {
      const { package_items } = obj_package;

      let products_on_package = package_items.reduce((prev, curr) => {
        let data_list = curr.product_items.reduce((last_data, product) => {
          const list_product = [
            ...last_data,
            {
              _id: product._id,
              name: product.name,
              has_stock: product.has_stock,
              product_stock_id: product.product_stocks[0]._id,
              product_stock_qty: product.product_stocks[0].quantity,
            },
          ];

          return list_product;
        }, []);

        return [...prev, ...data_list];
      }, []);

      delete obj_package.package_items;

      return {
        _id: obj_package._id,
        name: obj_package.name,
        has_stock: obj_package.has_stock,
        package_stock_id: obj_package.package_stocks._id,
        package_stock_qty: obj_package.package_stocks.quantity,
        products: products_on_package,
      };
    });
  };

  const recalculatePackageStock = async (packages) => {
    return packages.reduce((prev, pkg) => {
      const { products } = pkg;

      // soting dari urutan stock yg plaing kecil , dan akan dijadikan sebagai stock product package
      const package_stock = products.sort((a, b) => {
        return a.product_stock_qty - b.product_stock_qty;
      })[0].product_stock_qty;
      // memnentukan has_stock package dari peoduct minimal 1 true
      let has_stock = products.filter((obj) => obj.has_stock === true);
      has_stock = has_stock.length > 0 ? true : false;

      // cek kondisi has_stock dan jumlah kalkulasi apakah ada perubahan
      if (
        package_stock !== pkg.package_stock_qty ||
        has_stock !== pkg.has_stock
      ) {
        prev.push({
          ...pkg,
          package_stock_qty: package_stock,
          has_stock,
        });
      }

      return prev;
    }, []);
  };

  const updatePackages = async (data_diff) => {
    // update data diff
    if (data_diff.length > 0) {
      const updatePackages = [];
      const updateStocks = [];

      data_diff.forEach((obj) => {
        updatePackages.push({
          updateOne: {
            filter: {
              _id: obj._id,
              license,
            },
            update: {
              $set: { has_stock: obj.has_stock },
              $inc: { __v: 1 },
            },
          },
        });

        updateStocks.push({
          updateOne: {
            filter: {
              _id: obj.package_stock_id,
              license,
            },
            update: {
              $set: {
                quantity:
                  obj.package_stock_qty >= 0
                    ? obj.package_stock_qty
                    : parseFloat(0),
              },
              $inc: { __v: 1 },
            },
          },
        });
      });

      await db.collection(product_package).bulkWrite(updatePackages);
      await db.collection(product_stock).bulkWrite(updateStocks);

      return {
        success: true,
        message: data_diff.length.toString() + " package updated",
      };
    } else {
      return {
        success: true,
        message: "no one document package updated",
      };
    }
  };

  return Object.freeze({
    findProductPartOfPacakage,
    recalculatePackageStock,
    updatePackages,
  });
};
