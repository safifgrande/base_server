exports = async () => {
  console.log(context.user.data.user_id);

  await new Promise((resolve) => setTimeout(resolve, 1000));
  return {
    user: context.user.data.user_id,
    coba_user: context.coba_user,
  };
};
