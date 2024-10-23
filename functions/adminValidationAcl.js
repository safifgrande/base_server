module.exports = function (arg, list_acl) {
  if (!arg || !list_acl) return false;

  const aclExists = list_acl.find((v) => v === arg);
  return aclExists ? true : false;
};
