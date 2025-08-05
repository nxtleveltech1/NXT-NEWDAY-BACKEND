import express from 'express';
import { getCustomers } from '../controllers/customer.controller.js';

const router = express.Router();

// GET /api/customers - Retrieve all customers
router.get('/', getCustomers);

export default router;