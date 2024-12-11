module.exports = async () => {
  console.log(context.user.data.user_id);

  // return context.user.data.user_id;
  return {
    user: context.user.data.user_id,
    coba_user: context.coba_user,
  };
};
