exports = async (payload) => {
  try {
    const productMenuObject = await productMenu(payload);
    if (productMenuObject[payload.method]) {
      return await productMenuObject[payload.method]();
    }

    throw new Error("Method not found in request");
  } catch (e) {
    return context.functions.execute(
      "handleCatchError",
      e,
      payload,
      "productMenu"
    );
  }
};

const productMenu = async (payload) => {
  const valid = context.functions.execute("intValidation", payload.data);
  valid.isAuthenticated();

  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const user = context.functions.execute("intUserContext");

  const defaultField = {
    _partition: null,
    __v: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: BSON.ObjectId(user._id),
    updatedBy: BSON.ObjectId(user._id),
    license: null,
    outlet: null,
    user_id: BSON.ObjectId(user._id),
  };

  /*
    exports({
  "method":"POST",
  "headers":{
    "Lang":"id"
  },
  "data":{
    "id":"633a8cc0c70e5740bfbed24d",
    "outlet":"633a8cc0c70e5740bfbed225",
    "name":"POS Screen",
    "active":true,
    "pos_screen":true,
    "layouts":[
      {
        "id":"633a8cc0c70e5740bfbed24c",
        "items":[
          {
            "id":"633e82c4900ed5a2a4e58161",
            "type":"product",
            "product":"633e82a6900ed5a2a4e577e4",
            "x":0,
            "y":0
          },
          {
            "id":"633e8880387fd05cd8d731de",
            "type":"product",
            "product":"633e8274900ed5a2a4e568cd",
            "x":1,
            "y":0
          }
        ]
      }]
  },
  "filter":{}
})

    1. validasi request
    2. get old data
    3. handle product menu
  */
  const POST = async () => {
    // 1. validasi request
    await postValidation();
    // 2. get old data
    const oldData = await getOldData();

    // 3. handle product menu
    defaultField._partition = payload.filter.outlet.toString();
    defaultField.license = payload.filter.license;
    defaultField.outlet = payload.filter.outlet;

    return handleProductMenu(oldData);
  };

  /*
    exports({
      method: 'LIST',
      filter: {
        business_id: "611e1583f7bf5674c1785823",
        outlet_id: ""
      }
    })

    1. validate filter and acl
    2. get product menu list from DB
    3. build response
  */
  const LIST = async () => {
    // 1. validate filter and acl
    // validate ACL tapi tidak perlu throw error
    if (!(await valid.hasPermission(["bo_product"], false))) {
      return [];
    }

    // 2. get product menu list from DB
    const listProductMenu = await LISTProductMenu();

    // 3. build response
    return listProductMenu.map((menu) => {
      const {
        _id,
        outlet: { _id: outlet_id, name: outlet_name },
        ...tempMenu
      } = menu;
      delete tempMenu.lowerName;
      return {
        id: _id.toString(),
        outlet_id: outlet_id.toString(),
        outlet_name,
        ...tempMenu,
      };
    });
  };

  /*
    exports({
      method: 'GET',
      filter: {
        id: 'id'
      }
    })
  */

  const getValidation = async () => {
    if (!(await valid.hasPermission(["bo_product"], false))) {
      return [];
    }

    let { filter } = payload;

    if (!filter) {
      filter = {};
    }
    // default filter
    filter.license = BSON.ObjectId(user.license.toString());

    if (!filter.id) {
      throw new Error("E30023BE");
    }

    // request
    filter._id = BSON.ObjectId(payload.filter.id.toString());
    delete filter.id;
  };

  const GET = async () => {
    let { filter } = payload;

    await getValidation();

    const getItems = async (schemaName) => {
      return db
        .collection(schemaName)
        .aggregate([
          {
            $match: {
              license: BSON.ObjectId(user.license.toString()),
            },
          },
          {
            $project: {
              _id: 1,
              name: 1,
            },
          },
        ])
        .toArray();
    };

    const packagelist = await getItems(collectionNames.product_package);

    const grouplist = await getItems(collectionNames.product_groups);

    const departmentlist = await getItems(collectionNames.product_departments);

    const productlist = await getItems(collectionNames.products);

    const variantlist = await getItems(collectionNames.product_menu_variant);

    const menulist = await getItems(collectionNames.product_menu);

    const generateProductItem = async (v) => {
      let product_item;

      if (v.product) {
        const item = await productlist.find(
          (list) => list._id == v.product.toString()
        );
        product_item = {
          id: item._id.toString(),
          name: item.name,
        };
      }

      if (v.department) {
        const item = await departmentlist.find(
          (list) => list._id == v.department.toString()
        );
        product_item = {
          id: item._id.toString(),
          name: item.name,
        };
      }

      if (v.package) {
        const item = await packagelist.find(
          (list) => list._id == v.package.toString()
        );
        product_item = {
          id: item._id.toString(),
          name: item.name,
        };
      }

      if (v.menu_variant) {
        const item = await variantlist.find(
          (list) => list._id == v.menu_variant.toString()
        );
        product_item = {
          id: item._id.toString(),
          name: item.name,
        };
      }

      if (v.menu) {
        const item = await menulist.find(
          (list) => list._id == v.menu.toString()
        );
        product_item = {
          id: item._id.toString(),
          name: item.name,
        };
      }

      if (v.group) {
        const item = await grouplist.find(
          (list) => list._id == v.group.toString()
        );
        product_item = {
          id: item._id.toString(),
          name: item.name,
        };
      }

      return product_item;
    };

    return (
      await db
        .collection(collectionNames.product_menu)
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
              from: "product_layout",
              let: { product_layouts: "$product_layouts" },
              pipeline: [
                { $match: { $expr: { $in: ["$_id", "$$product_layouts"] } } },
                {
                  $lookup: {
                    from: "product_layout_item",
                    localField: "items",
                    foreignField: "_id",
                    as: "items",
                  },
                },
                {
                  $project: {
                    _id: 1,
                    items: {
                      _id: 1,
                      position_x: 1,
                      position_y: 1,
                      type: 1,
                      group: 1,
                      department: 1,
                      product: 1,
                      menu: 1,
                      menu_variant: 1,
                      package: 1,
                    },
                  },
                },
              ],
              as: "product_layouts",
            },
          },
          {
            $project: {
              name: 1,
              active: 1,
              pos_screen: 1,
              outlet: { _id: 1, name: 1, business_id: 1 },
              product_layouts: {
                _id: 1,
                items: {
                  _id: 1,
                  position_x: 1,
                  position_y: 1,
                  type: 1,
                  group: 1,
                  department: 1,
                  product: 1,
                  menu: 1,
                  menu_variant: 1,
                  package: 1,
                },
              },
            },
          },
        ])
        .toArray()
    ).map(async (menu) => {
      const {
        _id,
        name,
        active,
        pos_screen,
        outlet: [{ _id: outlet_id, name: outlet_name, business_id }],
        product_layouts,
      } = menu;

      const layouts = product_layouts.map((layout) => {
        const itemlist = layout.items.map(async (v) => {
          return {
            id: v._id.toString(),
            x: v.position_x,
            y: v.position_y,
            type: v.type,
            product_item: generateProductItem(v),
          };
        });

        return {
          id: layout._id.toString(),
          items: itemlist,
        };
      });

      return {
        id: _id.toString(),
        outlet_id: outlet_id.toString(),
        outlet_name,
        business_id: business_id.toString(),
        name,
        active,
        pos_screen,
        layouts,
      };
    })[0];
  };

  /*
    Request :

    {
      method: 'ACTIVE',
      data: {
        active: true | false
      },
      filter: {
        id: 'menu_id'
      }
    }

    1. validation
    2. update package status
  */
  const ACTIVE = async () => {
    // default filter
    payload.filter.license = BSON.ObjectId(user.license.toString());

    // payload filter
    payload.filter._id = BSON.ObjectId(payload.filter.id.toString());
    payload.filter.outlet = BSON.ObjectId(payload.filter.outlet_id.toString());
    delete payload.filter.id;
    delete payload.filter.outlet_id;

    // 1. validation
    await validationStatusRequest();

    // 2. update package status
    const foundMenu = await db
      .collection(collectionNames.product_menu)
      .findOneAndUpdate(
        { ...payload.filter },
        {
          $set: {
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user._id),

            active: payload.data.active,
          },
        },
        {
          projection: { _id: 1 },
        }
      );

    if (!foundMenu) {
      // jika return null, artinya id tidak ditemukan di DB
      throw new Error("E20059BE");
    }

    return payload.filter._id.toString();
  };

  /*
    {
      "method":"LITE",
      "filter":{
        "business_id":"611e1583f7bf5674c1785823",
        "outlet_id":"611e1583f7bf5674c1785822",
        "exclude_id":"611e1583f7bf5674c1785822"
      }
    }

    1. validation
    2. fetch dept
  */
  const LITE = async () => {
    // 1. validation
    await LITEValidation();

    // 2. fetch dept
    const menus = await dbLITEGetMenu();

    return menus.map(({ _id, name }) => {
      return {
        id: _id.toString(),
        name,
      };
    });
  };

  const validationStatusRequest = async () => {
    // validate ACL tapi tidak perlu throw error
    await valid.hasPermission(["bo_product"]);
    if (!payload.filter) throw new Error("E20037BE");
    if (!payload.filter._id) throw new Error("E20058BE");
  };

  const layoutItemValidation = () => {
    let { data } = payload;

    data.layouts.map((layout) => {
      layout.items.map((item, index) => {
        if (item.x == undefined || item.x == null) throw new Error("E20054BE");
        if (!item.type) throw new Error("E20051BE");
        if (!item[item.type]) throw new Error("E20054BE");

        // mencari lokasi yang sama
        if (
          layout.items.findIndex(
            (i, idx) =>
              idx !== index && `${i.x},${i.y}` === `${item.x},${item.y}`
          ) > -1
        ) {
          throw new Error("E20057BE");
        }
      });
    });
  };

  const layoutsValidation = () => {
    let { data } = payload;
    if (!Array.isArray(data.layouts))
      throw new Error("Type data product layout bukan array !");

    data.layouts = data.layouts.reduce((prev, layout) => {
      if (!layout.items || layout.items.length === 0) {
        return prev;
      }
      return [...prev, layout];
    }, []);

    if (!data.layouts) throw new Error("E20052BE");
    if (data.layouts.length === 0) throw new Error("E20052BE");

    layoutItemValidation();
  };

  const aclValidation = async () => {
    await valid.hasPermission(["bo_product"]);
  };

  const postValidation = async () => {
    let { data } = payload;

    // validate ACL
    await aclValidation();

    // validasi request ================
    if (!data.outlet) throw new Error("E20033BE");
    if (!data.name) throw new Error("E20051BE");
    if (data.pos_screen === null) throw new Error("POS Screen value null !");

    // validasi data layouts
    layoutsValidation();
    // =================================

    // arrange the filter
    if (!payload.filter) payload.filter = {};

    // default filter
    payload.filter.license = BSON.ObjectId(user.license.toString());

    // payload filter
    payload.filter.outlet = payload.data.outlet = BSON.ObjectId(
      payload.data.outlet.toString()
    );

    if (payload.data.pos_screen && !payload.data.active) {
      throw new Error("E20013BE");
    }

    if (payload.data.id) {
      // convert _id jadi ObjectId
      payload.filter._id = BSON.ObjectId(payload.data.id.toString());
    }
    delete payload.data.id;

    // convert item id jadi ObjectId
    payload.data.layouts = payload.data.layouts.map((layout) => {
      layout.items = layout.items.map((item) => {
        Object.keys(item).forEach((key) => {
          if (["id", "type", "x", "y"].indexOf(key) == -1) {
            item[key] =
              key === item.type ? BSON.ObjectId(item[item.type]) : undefined;
          }
        });
        return item;
      });

      return layout;
    });

    // validasi Duplikasi data di DB =====================
    await duplicateNameValidation();
    // =================================

    // validate each menu item ==============
    // flatened list
    // const temp = [["product", [objId, ObjId]]];
    await itemExistValidation();

    // =================================
  };

  const itemExistValidation = async () => {
    const temp = [];
    payload.data.layouts.map((layout, layoutIndex) => {
      layout.items.map((item) => {
        const fil_index = temp.findIndex((v) => v[[0]] === item.type);

        if (fil_index > -1) {
          temp[fil_index][1].push({ id: item[item.type], layout: layoutIndex });
        } else {
          temp.push([
            item.type,
            [{ id: item[item.type], layout: layoutIndex }],
          ]);
        }
      });
    });

    const validItem = await Promise.all(
      temp.map((item) => {
        return validateId(item);
      })
    );

    if (!validItem.every((v, index) => temp[index][1].length === v)) {
      throw new Error("E30123BE");
    }
  };

  const duplicateNameValidation = async () => {
    const filter = {
      ...payload.filter,
      name: { $regex: payload.data.name, $options: "i" },
    };
    if (payload.filter._id) {
      filter._id = { $ne: payload.filter._id };
    }

    const duplicateName = await db
      .collection(collectionNames.product_menu)
      .count(filter);

    if (duplicateName > 0) {
      throw new Error("E30022BE");
    }
  };

  const validateId = async (item) => {
    // validate each item
    const [type, itemlist] = item;

    // daftar schema yang berhubungan dengan menu
    const schemaMap = {
      group: collectionNames.product_groups,
      department: collectionNames.product_departments,
      product: collectionNames.products,
      menu_variant: collectionNames.product_menu_variant,
      menu: collectionNames.product_menu,
      package: collectionNames.product_package,
    };

    const data = itemlist.reduce((prev, objItem) => {
      const findPrevindex = prev.findIndex(
        (elem) => elem.layout === objItem.layout
      );

      if (findPrevindex > -1) {
        prev[findPrevindex].list_id.push(objItem.id);
      } else {
        prev.push({
          layout: objItem.layout,
          list_id: [objItem.id],
        });
      }

      return prev;
    }, []);

    const map_data = await Promise.all(
      data.map(async (obj) => {
        const { list_id } = obj;

        return db
          .collection(collectionNames[schemaMap[type]])
          .count({ _id: { $in: list_id }, license: user.license });
      })
    );

    return map_data.reduce((prev, num) => num + prev, 0);
  };

  const getOldData = async () => {
    const {
      filter: { _id },
    } = payload;
    if (_id) {
      return db
        .collection(collectionNames.product_menu)
        .aggregate([
          {
            $match: { _id, license: user.license }, // need license
          },
          {
            $lookup: {
              from: "product_layout",
              let: { layouts: "$product_layouts" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $in: ["$_id", "$$layouts"],
                    },
                  },
                },
                {
                  $lookup: {
                    from: "product_layout_item",
                    let: { items: "$items" },
                    pipeline: [
                      {
                        $match: {
                          $expr: {
                            $in: ["$_id", "$$items"],
                          },
                        },
                      },
                      {
                        $project: {
                          position_x: 1,
                          position_y: 1,
                          type: 1,
                          group: 1,
                          department: 1,
                          product: 1,
                          menu: 1,
                          menu_variant: 1,
                          package: 1,
                        },
                      },
                    ],
                    as: "items",
                  },
                },
                {
                  $project: { _id: 1, items: 1 },
                },
              ],
              as: "product_layouts",
            },
          },
          {
            $project: {
              name: 1,
              pos_screen: 1,
              active: 1,
              product_layouts: 1,
            },
          },
        ])
        .toArray();
    }

    return [];
  };

  const handleProductMenu = async (oldData) => {
    const {
      data: { name, pos_screen, layouts, active },
    } = payload;

    let result = null;

    if (oldData.length > 0) {
      // update menu
      await POSTUpdateHandler(oldData, { name, pos_screen, layouts, active });
      result = oldData[0]._id.toString();
    } else {
      // create menu
      const newProductMenu = await insertNewProductMenu({
        name,
        pos_screen,
        layouts,
        active,
      });
      result = newProductMenu.insertedId.toString();
    }

    if (pos_screen === true) {
      await updateOldPOSScreen(BSON.ObjectId(result), defaultField.outlet);
    }

    return result;
  };

  const handleInsertProductLayout = async (layouts) => {
    const layoutDocuments = await Promise.all(
      layouts.map(async (layout) => {
        const datainsert = {
          _id: new BSON.ObjectId(),
          ...defaultField,
          active: true,
          items: await handleInsertProductLayoutItem(layout.items), // harus di flatten ke atas
        };

        return datainsert;
      })
    );

    const newProductLayout = await db
      .collection(collectionNames.product_layout)
      .insertMany(layoutDocuments);

    return newProductLayout.insertedIds;
  };

  const InsertProductLayoutItemQuery = (items) => {
    // cek duplikat item, apakah item yang dikirim dihalaman tersebut ada item yang sama
    let arrayOfIdItem = items.map((item) => item[item.type]);
    let countEach = {};

    for (let idItem of arrayOfIdItem) {
      countEach[idItem] = (countEach[idItem] || 0) + 1;
    }

    if (Object.values(countEach).filter((x) => x > 1).length > 0) {
      throw new Error("E20091BE");
    } else {
      const itemIds = [];

      const insertQuery = items.map((eachItem) => {
        const itemId = new BSON.ObjectId();

        itemIds.push(itemId);
        return {
          insertOne: {
            document: {
              _id: itemId,
              ...defaultField,
              active: true,
              position_x: eachItem.x,
              position_y: eachItem.y,
              type: eachItem.type,
              [eachItem.type]: eachItem[eachItem.type],
            },
          },
        };
      });

      return {
        itemIds,
        insertQuery,
      };
    }
  };

  const handleUpdateProductLayout = async (oldLayouts, newLayouts) => {
    // remove not exists layout
    removeLayout(newLayouts, oldLayouts);
    const productLayoutQuery = [];
    const layoutItemQuery = [];
    const updateItemIds = [];
    const removeLayoutItemQuery = [];

    const result = await Promise.all(
      newLayouts.map(async (layout) => {
        if (!layout.id) {
          const layoutItems = InsertProductLayoutItemQuery(layout.items);

          layoutItemQuery.push(...layoutItems.insertQuery);

          const layoutId = new BSON.ObjectId();
          productLayoutQuery.push({
            insertOne: {
              document: {
                _id: layoutId,
                ...defaultField,
                active: true,
                items: layoutItems.itemIds,
              },
            },
          });

          return layoutId;
        } else {
          // update layout

          const updatedLayout = await updateLayout(
            layout,
            oldLayouts.find(
              (oldLayout) => oldLayout._id.toString() === layout.id.toString()
            )
          );

          updateItemIds.push(...updatedLayout.updateItemIds);
          layoutItemQuery.push(...updatedLayout.layoutItemsQuery);

          if (updatedLayout.removeLayoutItemQuery) {
            removeLayoutItemQuery.push(updatedLayout.removeLayoutItemQuery);
          }
          if (updatedLayout.query) {
            productLayoutQuery.push(updatedLayout.query);
          }

          return updatedLayout.id;
        }
      })
    );

    if (updateItemIds.length > 0) {
      const findItem = await db
        .collection(collectionNames.product_layout_item)
        .find({
          _id: { $in: updateItemIds },
          license: user.license,
        })
        .toArray();

      if (findItem.length !== updateItemIds.length) {
        throw new Error("E30025BE");
      }
    }

    if (layoutItemQuery.length > 0) {
      await db
        .collection(collectionNames.product_layout_item)
        .bulkWrite(layoutItemQuery);
    }

    if (productLayoutQuery.length > 0) {
      await db
        .collection(collectionNames.product_layout)
        .bulkWrite(productLayoutQuery);
    }

    if (removeLayoutItemQuery.length > 0) {
      await db
        .collection(collectionNames.product_layout_item)
        .bulkWrite(removeLayoutItemQuery);
    }

    return result;
  };

  const removeLayout = async (newLayouts, oldLayouts) => {
    const newLayoutIds = newLayouts.reduce(
      (prev, layout) => (layout.id ? [...prev, layout.id.toString()] : prev),
      []
    );
    const oldLayoutIds = oldLayouts.map((layout) => layout._id.toString());
    const removeLayoutQuery = [];

    const removedLayouts = oldLayoutIds
      .filter((layoutId) => {
        return !newLayoutIds.includes(layoutId);
      })
      .map((layoutId) => {
        // remove layout items
        const layoutItemIds = oldLayouts
          .find((layout) => layout._id.toString() === layoutId)
          .items.map((layout) => BSON.ObjectId(layout._id.toString()));

        removeLayoutQuery.push({
          deleteMany: {
            filter: {
              _id: { $in: layoutItemIds },
              license: user.license,
            },
          },
        });
        return BSON.ObjectId(layoutId);
      });

    if (removeLayoutQuery.length > 0) {
      await db
        .collection(collectionNames.product_layout_item)
        .bulkWrite(removeLayoutQuery);
    }

    if (removedLayouts.length > 0) {
      await db.collection(collectionNames.product_layout).deleteMany({
        _id: { $in: removedLayouts },
        license: user.license,
      });
    }
  };

  const updateLayout = async (newLayout, oldLayout) => {
    // update each layout

    const removeLayoutItemQuery = searchRemovedLayoutItems(
      oldLayout.items,
      newLayout.items
    );

    const updateItemIds = [];
    const layoutItemsQuery = [];

    const layoutItems = await Promise.all(
      newLayout.items.map(async (item, index) => {
        if (item.id) {
          // ID yang di kirim berbeda dengan yang ada di db
          updateItemIds.push(BSON.ObjectId(item.id));
          return BSON.ObjectId(item.id);
        } else {
          const layoutitems = InsertProductLayoutItemQuery([item]);

          layoutItemsQuery.push(...layoutitems.insertQuery);

          // insert layout item barus
          return layoutitems.itemIds[0];
        }
      })
    );
    // jika terjadi perubahan susunan layout item

    const query = {
      updateOne: {
        filter: {
          _id: BSON.ObjectId(newLayout.id.toString()),
          license: user.license,
        },
        update: {
          $set: {
            updatedAt: new Date(),
            updatedBy: BSON.ObjectId(user._id),
            items: layoutItems,
          },
        },
      },
    };

    return {
      id: BSON.ObjectId(oldLayout._id.toString()),
      query,
      updateItemIds,
      layoutItemsQuery,
      removeLayoutItemQuery,
    };
  };

  const searchRemovedLayoutItems = (oldItems, newItems) => {
    const newItemIds = newItems.map((item) => item.id.toString());
    const oldItemIds = oldItems.map((item) => item._id.toString());
    const removedItems = oldItemIds
      .filter((itemId) => !newItemIds.includes(itemId))
      .map((itemId) => BSON.ObjectId(itemId));

    if (removedItems.length > 0) {
      return {
        deleteMany: {
          filter: {
            _id: {
              $in: removedItems,
            },
            license: user.license,
          },
        },
      };
    }

    return null;
  };

  const handleInsertProductLayoutItem = async (items) => {
    // cek duplikat item, apakah item yang dikirim dihalaman tersebut ada item yang sama
    let arrayOfIdItem = items.map((item) => item[item.type]);
    let countEach = {};

    for (let idItem of arrayOfIdItem) {
      countEach[idItem] = (countEach[idItem] || 0) + 1;
    }

    if (Object.values(countEach).filter((x) => x > 1).length > 0) {
      throw new Error("E20091BE");
    } else {
      const newLayoutItem = await db
        .collection(collectionNames.product_layout_item)
        .insertMany(
          items.map((item) => {
            let itemObject = {
              _id: new BSON.ObjectId(),
              ...defaultField,
              active: true,
              // bisa dibuat spread operator, tapi tidak saya gunakan
              // karena data yang masuk harus dipastikan field-nya ada semua
              // kalau field-nya ada yang hilang,
              // di POS akan di anggap user corrupt
              position_x: item.x,
              position_y: item.y,
              type: item.type,
            };

            // masukkan hanya yang sesuai typenya contoh type product, maka hanya product: id yang dikirim, sisanya tidak dikirim
            itemObject[itemObject.type] = item[itemObject.type];
            return itemObject;
          })
        );

      return newLayoutItem.insertedIds;
    }
  };

  // Database helper
  const insertNewProductMenu = async ({
    name,
    pos_screen,
    layouts,
    active,
  }) => {
    const insertData = {
      _id: new BSON.ObjectId(),
      ...defaultField,

      name,
      pos_screen,
      active,
      product_layouts: await handleInsertProductLayout(layouts),
    };
    return db.collection(collectionNames.product_menu).insertOne(insertData);
  };

  const updateProductMenu = async (_id, dataToUpdate) => {
    await db.collection(collectionNames.product_menu).updateOne(
      {
        _id,
        license: defaultField.license,
      },
      {
        $set: dataToUpdate,
      }
    );
  };

  const updateOldPOSScreen = async (id, outlet) => {
    await db.collection(collectionNames.product_menu).updateMany(
      {
        pos_screen: true,
        _id: { $ne: id },
        outlet: outlet,
        license: defaultField.license,
      },
      { $set: { pos_screen: false } }
    );
  };

  const LISTProductMenu = async () => {
    const {
      filter: { outlet_id, business_id },
    } = payload;

    const filter = {
      license: BSON.ObjectId(user.license.toString()),
    };

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

    return db
      .collection(collectionNames.product_menu)
      .aggregate([
        { $match: filter },
        {
          $lookup: {
            from: collectionNames.outlet,
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
            name: 1,
            active: 1,
            outlet: { _id: 1, name: 1 },
            pos_screen: 1,
            lowerName: { $toLower: "$name" },
          },
        },
        { $sort: { lowerName: 1 } },
      ])
      .toArray();
  };

  const dbLITEGetMenu = async () => {
    const {
      filter: { outlet_id, exclude_id },
    } = payload;

    const filter = {
      license: user.license,
      active: true,
      outlet: BSON.ObjectId(outlet_id.toString()),
    };

    if (exclude_id) {
      filter._id = { $ne: BSON.ObjectId(exclude_id.toString()) };
    }

    return db
      .collection(collectionNames.product_menu)
      .find(filter, { name: 1 })
      .toArray();
  };

  // Helper function
  const POSTUpdateHandler = async (
    oldData,
    { name, pos_screen, layouts, active }
  ) => {
    const hasChanges =
      layouts.findIndex((layout) => !layout.id) > -1 ||
      layouts.length !== oldData[0].product_layouts.length;

    const dataToUpdate = {
      product_layouts: await handleUpdateProductLayout(
        oldData[0].product_layouts,
        layouts
      ),
    };

    // handle jika terjadi perubahan data
    if (
      oldData[0].name !== name ||
      oldData[0].pos_screen !== pos_screen ||
      oldData[0].active !== active ||
      hasChanges
    ) {
      dataToUpdate.updatedAt = new Date();
      dataToUpdate.updatedBy = BSON.ObjectId(user._id);
      dataToUpdate.name = name;
      dataToUpdate.pos_screen = pos_screen;
      dataToUpdate.active = active;

      await updateProductMenu(oldData[0]._id, dataToUpdate);
    }
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

  return Object.freeze({ POST, LIST, GET, ACTIVE, LITE });
};
