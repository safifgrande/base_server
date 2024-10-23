module.exports = async () => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve('Data fetched successfully');
      // You can call reject('An error occurred') to simulate an error
    }, 1000);
  })
}