import express from 'express';
import { listing } from '../controllers/api/role.controller';
import { deptlisting } from '../controllers/api/department.controller';
import { updateStatus } from '../controllers/user.controller';
// This file is part of the Express.js application routing.
var router = express.Router();

router.get('/roles', listing);
router.get('/department', deptlisting);
router.put("/update-status/:id",updateStatus) 
export default router;
