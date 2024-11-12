// src/modules/user/user.controller.js
const userService = require('./example.service');

const a = async (req, res) => {
  const users = await userService.getAllUsers();
  res.json(users);
};

const b = async (req, res) => {
  res.json({
    body: req.body,
    param: req.params
  })
}

module.exports = { a, b };