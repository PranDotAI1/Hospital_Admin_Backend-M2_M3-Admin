import express from 'express';
// This file is part of the Express.js application routing.
var router = express.Router();

router.get('/', function (req, res, next) {
  res.send('Welcome to user router111');
});

export default router;
