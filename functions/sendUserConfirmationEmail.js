/*
  function ini dipakek untuk send or resend email verification
  {
    email,
    fullname,
  }
*/

module.exports = async (payload) => {
  const mongodb = context.services.get(context.values.get("CLUSTER_NAME"));
  const db = mongodb.db(context.values.get("DB_NAME"));
  const collectionNames = context.values.get("COLLECTION_NAMES");

  const email = payload.email;

  const user = await db.collection(collectionNames.user).findOne(
    {
      email: email.toLowerCase(),
    },
    { email_confirmed: 1, fullname: 1, license: 1 }
  );

  if (!user) {
    throw new Error("E30026BE");
  }

  if (user.email_confirmed) {
    throw new Error("E30029BE");
  }

  const urlGetToken =
    context.environment.values.SETUP_EMAIL_SERVER + "/api/auth/generateToken";
  const urlSendEmail =
    context.environment.values.SETUP_EMAIL_SERVER +
    "/api/users/sendverification";
  const emailTemplate = context.values.get("EMAIL_TEMPLATE");
  const token = Buffer.from(email, "utf8").toString("base64");
  const fullVerifyURL = `${context.environment.values.SETUP_EMAIL_VERIFIER}?data=${token}`;

  const getToken = await context.http.post({
    url: urlGetToken,
    headers: {
      "Content-Type": ["application/json"],
      Accept: ["application/json"],
    },
    body: {
      email: email,
    },
    encodeBodyAsJSON: true,
  });

  const tokenJwt = EJSON.parse(getToken.body.text()).token;

  // FIXME: Body untuk fromName dan fromAddress perlu di ganti jika di production
  const sendEmailResult = await context.http.post({
    url: urlSendEmail,
    headers: {
      "Content-Type": ["application/json"],
      Authorization: [`Bearer ${tokenJwt}`],
      Accept: ["application/json"],
    },
    body: {
      to: email,
      toName: user.fullname,
      fromName: "Grande POS <cs@grandepos.io>",
      fromAddress: "cs@grandepos.io",
      subject: "Verifikasi alamat Email akun Grande POS Anda",
      link: fullVerifyURL,
      template: emailTemplate.register,
    },
    encodeBodyAsJSON: true,
  });
  const sendEmailResultData = EJSON.parse(sendEmailResult.body.text());

  if (!sendEmailResultData.status) {
    throw new Error("Cannot send email verification to : " + email);
  }

  return sendEmailResultData.status;
};
