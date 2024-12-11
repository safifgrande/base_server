module.exports = async (payload) => {
  if (context.user.data.user_id === "dea.edria@gmail.com") {
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve();
      }, 1000);
    });
  }
  return { ...payload, session: context.user.data.user_id };
};
