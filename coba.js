const ivm = require('isolated-vm');
let setup = async function () {
  const isolate = new ivm.Isolate();
  const context = await isolate.createContext();
  const jail = context.global;
  jail.setSync('log', function (...args) {
    console.log(...args);
  });

  // Create and set the context data
  const contextObj = {
    user: {
      data: {
        user_id: 'yuda test'
      }
    }
  };

  await context.global.set('context', contextObj, { copy: true });

  const fn = `
    exports = async () => {
      log(context.user)
    
      return {
        name: 'test'
      }
    };
  `;
  const compiledFn = await isolate.compileScript(fn);
  await compiledFn.run(context);
  // Execute the function using eval instead of direct reference
  const result = await context.eval(`
      (async () => {
        const test = await exports();
        return JSON.stringify(test)
      })()
    `, {
    timeout: 1000,
    promise: true,
    result: { copy: true }
  });

  return JSON.parse(result);
};

setup().then((result) => {
  console.log(result);
}).catch((err) => {
  console.log(err);
});