import express from 'express';
import { getDashboardOverview } from '../controllers/dashboard.controller.js';

const router = express.Router();

// GET /api/dashboard/overview - Retrieve dashboard overview data
router.get('/overview', getDashboardOverview);

export default router;