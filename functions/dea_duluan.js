const { setTimeout } = require("node:timers/promises");
module.exports = async () => {
  console.log(context.user.data.user_id);

  await setTimeout(500);
  return {
    user: context.user.data.user_id,
    coba_user: context.coba_user,
  };
};
