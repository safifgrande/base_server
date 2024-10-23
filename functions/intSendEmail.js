/*
    payload: {
      to: 'string',
      from: 'string',
      subject: 'string',
      path: 'string',
      body: {
        key: 'string',
        data: mixed
      }
    }
  */
module.exports = async (payload) => {
  try {
    const handler = mainHandler(payload);
    return handler.sendEmail(await handler.getJWT());
  } catch (error) {
    context.functions.execute("handleCatchError", error, "", "intSendEmail");

    throw new Error(error.message);
  }
};

const mainHandler = (payload) => {
  const emailServer = context.environment.values.SETUP_EMAIL_SERVER;
  const urlGetToken = `${emailServer}/api/auth/generateToken`;
  const urlSendEmail = `${emailServer}/send-email`;

  const getJWT = async () => {
    const getToken = await context.http.post({
      url: urlGetToken,
      headers: {
        "Content-Type": ["application/json"],
        Accept: ["application/json"],
      },
      body: {
        email: payload.to,
      },
      encodeBodyAsJSON: true,
    });

    return JSON.parse(getToken.body.text()).token;
  };

  const sendEmail = async (tokenJwt) => {
    const result = await context.http.post({
      url: urlSendEmail,
      headers: {
        "Content-Type": ["application/json"],
        Authorization: [`Bearer ${tokenJwt}`],
        Accept: ["application/json"],
      },
      body: JSON.stringify(payload),
    });

    const resultBody = JSON.parse(result.body.text());

    if (resultBody.status != 200) {
      throw new Error("Cannot send email verification to : " + payload.to);
    }

    return resultBody.status;
  };

  return Object.freeze({ getJWT, sendEmail });
};
