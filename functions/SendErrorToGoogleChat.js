module.exports = async (url, msg) => {
  let body = { text: msg };

  if (typeof msg === "object") {
    body = msg;
  }

  await context.http.post({
    url: url,
    headers: { "Content-Type": ["application/json"] },
    body,
    encodeBodyAsJSON: true,
  });
};
