const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();
function requestStorageMiddleware(req, res, next) {
  asyncLocalStorage.run(new Map(), () => {
    next();
  });
}

function getAuthUser() {
  const store = asyncLocalStorage.getStore();

  return store.get("user");
}

function setAuthUser(user) {
  const store = asyncLocalStorage.getStore();
  store.set("user", user);
}

module.exports = {
  // asyncLocalStorage,
  getAuthUser,
  setAuthUser,
  requestStorageMiddleware,
};
