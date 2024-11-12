const { a, b } = require("./example.controller")
const express = require('express');

const router = express.Router();

router.get("/", a)
router.post("/:id", b)

module.exports = router