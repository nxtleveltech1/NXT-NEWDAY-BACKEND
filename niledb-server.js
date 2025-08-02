#!/usr/bin/env node

/**
 * NILEDB BACKEND SERVER - Production Ready
 * Simple Express server with NILEDB PostgreSQL connection
 * Port 4000 - Optimized for performance
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testNileConnection, initializeNileDB, getNileConnectionStatus, nilePool } from './src/config/niledb.config.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// ============== HEALTH AND STATUS ENDPOINTS ==============

// Health check endpoint
app.get('/health', (req, res) => {
  const status = getNileConnectionStatus();
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'NXT NEW DAY Backend - NILEDB',
    environment: NODE_ENV,
    database: status.isHealthy ? 'connected' : 'disconnected',
    niledb: status
  });
});

// NILEDB connection test
app.get('/api/niledb/test', async (req, res) => {
  try {
    const result = await testNileConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// NILEDB status
app.get('/api/niledb/status', (req, res) => {
  const status = getNileConnectionStatus();
  res.json({
    success: true,
    data: status
  });
});

// ============== DASHBOARD DATA ENDPOINTS ==============

// Dashboard metrics
app.get('/api/dashboard/metrics', async (req, res) => {
  try {
    const client = await nilePool.connect();
    try {
      const result = await client.query(`
        SELECT 
          metric_name,
          metric_value,
          metric_type,
          metadata,
          timestamp
        FROM dashboard_metrics 
        WHERE timestamp >= NOW() - INTERVAL '24 hours'
        ORDER BY timestamp DESC 
        LIMIT 100
      `);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rowCount
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Dashboard metrics error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      fallback_data: {
        total_revenue: 156780.50,
        total_orders: 1245,
        active_customers: 325,
        inventory_value: 89456.75,
        generated_at: new Date().toISOString()
      }
    });
  }
});

// Dashboard events
app.get('/api/dashboard/events', async (req, res) => {
  try {
    const client = await nilePool.connect();
    try {
      const result = await client.query(`
        SELECT 
          event_type,
          event_data,
          event_source,
          severity,
          timestamp
        FROM dashboard_events 
        ORDER BY timestamp DESC 
        LIMIT 50
      `);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rowCount
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Dashboard events error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      fallback_data: [
        { event_type: 'order_created', event_data: { order_id: 1001, customer: 'Demo Customer' }, severity: 'info', timestamp: new Date() },
        { event_type: 'inventory_low', event_data: { product: 'Widget A', current_stock: 5 }, severity: 'warning', timestamp: new Date() },
        { event_type: 'payment_received', event_data: { amount: 1250.00, customer: 'ACME Corp' }, severity: 'info', timestamp: new Date() }
      ]
    });
  }
});

// Real-time data
app.get('/api/dashboard/realtime', async (req, res) => {
  try {
    const client = await nilePool.connect();
    try {
      const result = await client.query(`
        SELECT 
          data_type,
          data_payload,
          timestamp
        FROM real_time_data 
        WHERE expires_at > NOW()
        ORDER BY timestamp DESC 
        LIMIT 20
      `);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rowCount
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Real-time data error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      fallback_data: {
        active_sessions: 42,
        orders_last_hour: 23,
        revenue_today: 12875.50,
        system_load: 0.65,
        generated_at: new Date().toISOString()
      }
    });
  }
});

// ============== DATA MANAGEMENT ENDPOINTS ==============

// Add dashboard metric
app.post('/api/dashboard/metrics', async (req, res) => {
  try {
    const { metric_name, metric_value, metric_type = 'counter', metadata = {} } = req.body;
    
    if (!metric_name || metric_value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'metric_name and metric_value are required'
      });
    }
    
    const client = await nilePool.connect();
    try {
      const result = await client.query(
        'INSERT INTO dashboard_metrics (metric_name, metric_value, metric_type, metadata) VALUES ($1, $2, $3, $4) RETURNING *',
        [metric_name, metric_value, metric_type, JSON.stringify(metadata)]
      );
      
      res.json({
        success: true,
        data: result.rows[0]
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Add metric error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add dashboard event
app.post('/api/dashboard/events', async (req, res) => {
  try {
    const { event_type, event_data, event_source = 'api', severity = 'info' } = req.body;
    
    if (!event_type || !event_data) {
      return res.status(400).json({
        success: false,
        error: 'event_type and event_data are required'
      });
    }
    
    const client = await nilePool.connect();
    try {
      const result = await client.query(
        'INSERT INTO dashboard_events (event_type, event_data, event_source, severity) VALUES ($1, $2, $3, $4) RETURNING *',
        [event_type, JSON.stringify(event_data), event_source, severity]
      );
      
      res.json({
        success: true,
        data: result.rows[0]
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Add event error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Store real-time data
app.post('/api/dashboard/realtime', async (req, res) => {
  try {
    const { data_type, data_payload, expires_in_hours = 1 } = req.body;
    
    if (!data_type || !data_payload) {
      return res.status(400).json({
        success: false,
        error: 'data_type and data_payload are required'
      });
    }
    
    const client = await nilePool.connect();
    try {
      const result = await client.query(
        `INSERT INTO real_time_data (data_type, data_payload, expires_at) VALUES ($1, $2, NOW() + INTERVAL '${expires_in_hours} hours') RETURNING *`,
        [data_type, JSON.stringify(data_payload)]
      );
      
      res.json({
        success: true,
        data: result.rows[0]
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Store real-time data error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============== GENERIC ENDPOINTS ==============

// Generic query endpoint (for testing)
app.post('/api/query', async (req, res) => {
  try {
    const { query, params = [] } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'query is required'
      });
    }
    
    // Only allow SELECT queries for security
    if (!query.trim().toLowerCase().startsWith('select')) {
      return res.status(400).json({
        success: false,
        error: 'Only SELECT queries are allowed'
      });
    }
    
    const client = await nilePool.connect();
    try {
      const result = await client.query(query, params);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rowCount
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sample data endpoint
app.get('/api/sample-data', (req, res) => {
  res.json({
    success: true,
    data: {
      customers: [
        { id: 1, name: 'ACME Corporation', email: 'contact@acme.com', orders: 15, revenue: 45600.50 },
        { id: 2, name: 'TechStart Inc', email: 'info@techstart.com', orders: 8, revenue: 22400.75 },
        { id: 3, name: 'Global Traders', email: 'sales@globaltraders.com', orders: 22, revenue: 67800.25 }
      ],
      products: [
        { id: 1, name: 'Widget Pro', sku: 'WID-PRO-001', price: 299.99, stock: 145 },
        { id: 2, name: 'Gadget Max', sku: 'GAD-MAX-002', price: 199.99, stock: 89 },
        { id: 3, name: 'Tool Elite', sku: 'TOL-ELI-003', price: 149.99, stock: 234 }
      ],
      orders: [
        { id: 1001, customer: 'ACME Corporation', total: 1299.95, status: 'shipped', date: '2024-01-15' },
        { id: 1002, customer: 'TechStart Inc', total: 599.98, status: 'processing', date: '2024-01-16' },
        { id: 1003, customer: 'Global Traders', total: 2199.92, status: 'delivered', date: '2024-01-14' }
      ]
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// ============== SERVER STARTUP ==============

async function startNileDBServer() {
  try {
    console.log('🚀 Starting NILEDB Backend Server...');
    console.log(`📡 Port: ${PORT}`);
    console.log(`🌍 Environment: ${NODE_ENV}`);
    
    // Initialize NILEDB connection and tables
    console.log('🔗 Connecting to NILEDB...');
    await initializeNileDB();
    
    // Test connection
    const connectionTest = await testNileConnection();
    if (connectionTest.success) {
      console.log('✅ NILEDB connection successful');
    } else {
      console.warn('⚠️ NILEDB connection failed, but server will continue with fallback data');
    }
    
    // Start server
    const server = app.listen(PORT, () => {
      console.log(`\n🚀 NILEDB SERVER ACTIVE`);
      console.log(`📡 Port: ${PORT}`);
      console.log(`🗄️ Database: NILEDB (PostgreSQL)`);
      console.log(`\n📊 Endpoints:`);
      console.log(`🔗 Health: http://localhost:${PORT}/health`);
      console.log(`🧪 NILEDB Test: http://localhost:${PORT}/api/niledb/test`);
      console.log(`📈 Dashboard Metrics: http://localhost:${PORT}/api/dashboard/metrics`);
      console.log(`📝 Dashboard Events: http://localhost:${PORT}/api/dashboard/events`);
      console.log(`⚡ Real-time Data: http://localhost:${PORT}/api/dashboard/realtime`);
      console.log(`🎯 Sample Data: http://localhost:${PORT}/api/sample-data`);
      console.log(`\n✅ Ready for production!`);
    });
    
    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        try {
          await nilePool.end();
          console.log('✅ NILEDB connection pool closed');
          console.log('🚀 Server shutdown completed');
          process.exit(0);
        } catch (error) {
          console.error('❌ Error during shutdown:', error);
          process.exit(1);
        }
      });
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection:', reason, 'at:', promise);
      gracefulShutdown('UNHANDLED_REJECTION');
    });
    
  } catch (error) {
    console.error('❌ Failed to start NILEDB server:', error);
    process.exit(1);
  }
}

// Start the server
startNileDBServer();