/* NO PAYLOAD JUST CALL THE FUNCTION TO RETURN ACL_KEYS */

module.exports = () => {
  try {
    const list_acl = context.values.get("ACL");

    return list_acl.map((v) => v.id);
  } catch (error) {
    context.functions.execute(
      "handleCatchError",
      error,
      "",
      "intTranslatingAcl"
    );
  }

  return [];
};
