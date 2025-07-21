import express from 'express';
import cors from 'cors';
import { testConnection } from "./src/config/database.js";

// Import route modules
import supplierRoutes from "./src/routes/supplier.routes.js";
import customerRoutes from "./src/routes/customer.routes.js";
import analyticsRoutes from "./src/routes/analytics.routes.js";
import purchaseOrderRoutes from "./src/routes/purchase-orders.routes.js";
import invoiceRoutes from "./src/routes/invoice.routes.js";

const app = express();
const PORT = 4002;

// Basic middleware
app.use(cors());
app.use(express.json());

// Mock authentication middleware for testing
function mockAuth(req, res, next) {
  req.user = {
    sub: 'test-user-123',
    roles: ['user'],
    permissions: []
  };
  next();
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    message: 'NXT Backend Endpoint Tester'
  });
});

// Test endpoints without authentication
app.get('/api/test/routes', (req, res) => {
  res.json({
    message: 'API routes testing endpoint',
    availableTests: [
      '/api/customers',
      '/api/suppliers', 
      '/api/inventory',
      '/api/analytics',
      '/api/purchase-orders',
      '/api/invoices'
    ],
    timestamp: new Date().toISOString()
  });
});

// Mount routes with mock authentication
app.use('/api/suppliers', mockAuth, supplierRoutes);
app.use('/api/customers', mockAuth, customerRoutes);  
app.use('/api/analytics', mockAuth, analyticsRoutes);
app.use('/api/purchase-orders', mockAuth, purchaseOrderRoutes);
app.use('/api/invoices', mockAuth, invoiceRoutes);

// Basic inventory endpoints (inline since they were in main index.js)
app.get('/api/inventory', mockAuth, (req, res) => {
  res.json({
    message: 'Inventory endpoint responding',
    status: 'success',
    data: [],
    pagination: {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0
    },
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Start server
async function startTestServer() {
  try {
    console.log('Testing database connection...');
    const dbConnected = await testConnection();
    console.log('Database connection:', dbConnected ? 'SUCCESS' : 'FAILED');
    
    app.listen(PORT, () => {
      console.log(`🧪 NXT Backend Endpoint Tester running on port ${PORT}`);
      console.log(`📋 Health check: http://localhost:${PORT}/health`);
      console.log(`🔗 Routes test: http://localhost:${PORT}/api/test/routes`);
      console.log(`✅ Ready for endpoint testing`);
    });
  } catch (error) {
    console.error('Failed to start test server:', error.message);
    process.exit(1);
  }
}

startTestServer();