module.exports = function (payload) {
  return EJSON.parse(payload.body.text());
};
