import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { testConnection } from "./src/config/database.js";
import customerRoutes from "./src/routes/customer.routes.js";
import supplierRoutes from "./src/routes/supplier.routes.js";
import analyticsRoutes from "./src/routes/analytics.routes.js";
import * as inventoryQueries from "./src/db/inventory-queries.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Basic middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Simple authentication mock for testing
const mockAuth = (req, res, next) => {
  req.user = { sub: 'test-user-id' };
  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'NXT NEW DAY Backend - Test Mode',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Mount routes with mock authentication
app.use("/api/customers", mockAuth, customerRoutes);
app.use("/api/suppliers", mockAuth, supplierRoutes);
app.use("/api/analytics", mockAuth, analyticsRoutes);

// Basic inventory endpoints for testing
app.get("/api/inventory", mockAuth, async (req, res) => {
  try {
    const params = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      search: req.query.search || '',
      warehouseId: req.query.warehouseId || null,
      stockStatus: req.query.stockStatus || null,
      belowReorderPoint: req.query.belowReorderPoint === 'true',
      sortBy: req.query.sortBy || 'createdAt',
      sortOrder: req.query.sortOrder || 'desc'
    };
    
    const result = await inventoryQueries.getInventory(params);
    res.json(result);
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Basic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start server
async function startTestServer() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }
    console.log('Database connection successful');

    app.listen(port, () => {
      console.log(`NXT Backend Test Server running on port ${port}`);
      console.log(`Health check: http://localhost:${port}/health`);
      console.log(`Customers: http://localhost:${port}/api/customers`);
      console.log(`Suppliers: http://localhost:${port}/api/suppliers`);
      console.log(`Inventory: http://localhost:${port}/api/inventory`);
      console.log(`Analytics: http://localhost:${port}/api/analytics`);
    });

  } catch (err) {
    console.error('Failed to start test server:', err);
    process.exit(1);
  }
}

startTestServer();