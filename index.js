const express = require("express");
const context = require("./engine/v1/context");
const authMiddleware = require("./engine/middleware/authMiddleware");

const app = express();
const port = 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/data", authMiddleware, async (req, res) => {
  console.log(context.user.data);
  res.send(
    await context.http().get("https://jsonplaceholder.typicode.com/todos/")
  );
});

app.get("/get_user", authMiddleware, async (req, res) => {
  res.send({ data: context.user.data });
});

app.post("/login", async (req, res) => {
  const body = req.body;
  if (body) {
    const valid = await context.functions.execute("intValidation");
    const db = await context.services.get("CORE_DB", "user");

    const currentUser = await db
      .aggregate([
        {
          $match: {
            username: body.username.toLowerCase(),
            password: valid.hashPassword(body.password),
            active: true,
          },
        },
        {
          $lookup: {
            as: "user_credentials",
            from: "user_credentials",
            localField: "credential_id",
            foreignField: "_id",
          },
        },
        {
          $unwind: "$user_credentials",
        },
        {
          $lookup: {
            from: "user_acl",
            let: { acl: "$user_credentials.acl" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$acl"] } } },
              {
                $project: {
                  bo_report: 1,
                },
              },
            ],
            as: "user_acl",
          },
        },
        {
          $unwind: "$user_acl",
        },
        {
          $project: {
            _id: 1,
            username: 1,
            license: 1,
            type: 1,
            fullname: 1,
            phone: 1,
            user_acl: 1,
          },
        },
      ])
      .toArray();

    res.status(200).json({
      message: "success",
      data: {
        realm_jwt: await context.functions.execute("intGenerateCustomJwt", {
          userData: currentUser[0],
        }),
      },
    });
  } else {
    res.status(401).json({ message: "no credential" });
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
