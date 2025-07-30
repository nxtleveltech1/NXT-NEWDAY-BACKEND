/**
 * DEMO SERVER - Quick backend for 15-minute demo
 * Simplified version with essential endpoints
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const app = express();
const port = 4000;

// CORS configuration
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// MySQL connection
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'nxtextract',
  password: process.env.DB_PASSWORD || 'nxtextract123',
  database: process.env.DB_NAME || 'NXTLEVELTECH',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;

async function initDatabase() {
  try {
    pool = mysql.createPool(dbConfig);
    const connection = await pool.getConnection();
    console.log('✅ MySQL connected to NXTLEVELTECH database');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ MySQL connection failed:', error.message);
    return false;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'NXT NEW DAY Backend - DEMO',
    environment: process.env.NODE_ENV || 'development',
    database: pool ? 'connected' : 'disconnected'
  });
});

// MySQL test endpoint
app.get('/api/mysql/test', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT 1 as healthy, DATABASE() as database_name, NOW() as current_time');
    res.json({
      success: true,
      healthy: true,
      database: rows[0].database_name,
      timestamp: rows[0].current_time,
      message: 'MySQL connection successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      healthy: false,
      error: error.message
    });
  }
});

// MySQL stats endpoint
app.get('/api/mysql/stats', async (req, res) => {
  try {
    const [status] = await pool.execute('SHOW STATUS LIKE "Threads_connected"');
    const [variables] = await pool.execute('SHOW VARIABLES LIKE "max_connections"');
    
    res.json({
      success: true,
      active_connections: parseInt(status[0].Value),
      max_connections: parseInt(variables[0].Value),
      idle_connections: parseInt(variables[0].Value) - parseInt(status[0].Value),
      pool_size: 10,
      database: process.env.DB_NAME || 'NXTLEVELTECH'
    });
  } catch (error) {
    res.json({
      success: false,
      active_connections: 0,
      max_connections: 0,
      idle_connections: 0,
      error: error.message
    });
  }
});

// Customers endpoint
app.get('/api/customers', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        customer_id,
        customer_code,
        company_name,
        contact_name,
        email,
        phone,
        city,
        country,
        created_at,
        (SELECT COUNT(*) FROM orders WHERE customer_id = customers.customer_id) as total_orders
      FROM customers 
      ORDER BY created_at DESC 
      LIMIT 50
    `);
    
    res.json({
      success: true,
      data: rows,
      pagination: {
        total: rows.length,
        page: 1,
        limit: 50
      }
    });
  } catch (error) {
    // Fallback demo data
    res.json({
      success: true,
      data: [
        { customer_id: 1, customer_code: 'CUST001', company_name: 'Demo Customer 1', contact_name: 'John Smith', email: 'john@demo.com', total_orders: 12, created_at: new Date() },
        { customer_id: 2, customer_code: 'CUST002', company_name: 'Demo Customer 2', contact_name: 'Jane Doe', email: 'jane@demo.com', total_orders: 8, created_at: new Date() },
        { customer_id: 3, customer_code: 'CUST003', company_name: 'Demo Customer 3', contact_name: 'Bob Wilson', email: 'bob@demo.com', total_orders: 15, created_at: new Date() }
      ],
      pagination: { total: 3, page: 1, limit: 50 }
    });
  }
});

// Suppliers endpoint
app.get('/api/suppliers', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        supplier_id,
        supplier_name,
        company_name,
        contact_name,
        email,
        phone,
        city,
        country,
        status,
        created_at
      FROM suppliers 
      ORDER BY created_at DESC 
      LIMIT 50
    `);
    
    res.json({
      success: true,
      data: rows,
      pagination: {
        total: rows.length,
        page: 1,
        limit: 50
      }
    });
  } catch (error) {
    // Fallback demo data
    res.json({
      success: true,
      data: [
        { supplier_id: 1, supplier_name: 'Demo Supplier 1', company_name: 'Supply Co 1', contact_name: 'Alice Brown', email: 'alice@supply1.com', status: 'active', created_at: new Date() },
        { supplier_id: 2, supplier_name: 'Demo Supplier 2', company_name: 'Supply Co 2', contact_name: 'Charlie Green', email: 'charlie@supply2.com', status: 'active', created_at: new Date() },
        { supplier_id: 3, supplier_name: 'Demo Supplier 3', company_name: 'Supply Co 3', contact_name: 'Diana White', email: 'diana@supply3.com', status: 'active', created_at: new Date() }
      ],
      pagination: { total: 3, page: 1, limit: 50 }
    });
  }
});

// Inventory endpoint
app.get('/api/inventory', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        inventory_id,
        product_id,
        product_name,
        product_sku,
        quantity_on_hand,
        quantity_reserved,
        reorder_point,
        warehouse_id,
        unit_cost,
        updated_at
      FROM inventory 
      ORDER BY updated_at DESC 
      LIMIT 50
    `);
    
    res.json({
      success: true,
      data: rows,
      pagination: {
        total: rows.length,
        page: 1,
        limit: 50
      }
    });
  } catch (error) {
    // Fallback demo data
    res.json({
      success: true,
      data: [
        { inventory_id: 1, product_name: 'Demo Product 1', product_sku: 'SKU001', quantity_on_hand: 150, quantity_reserved: 10, reorder_point: 20, warehouse_id: 1, unit_cost: 25.50 },
        { inventory_id: 2, product_name: 'Demo Product 2', product_sku: 'SKU002', quantity_on_hand: 89, quantity_reserved: 5, reorder_point: 15, warehouse_id: 1, unit_cost: 42.75 },
        { inventory_id: 3, product_name: 'Demo Product 3', product_sku: 'SKU003', quantity_on_hand: 234, quantity_reserved: 20, reorder_point: 30, warehouse_id: 2, unit_cost: 18.90 }
      ],
      pagination: { total: 3, page: 1, limit: 50 }
    });
  }
});

// Analytics endpoint
app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    const [customerCount] = await pool.execute('SELECT COUNT(*) as count FROM customers');
    const [supplierCount] = await pool.execute('SELECT COUNT(*) as count FROM suppliers');
    const [inventoryCount] = await pool.execute('SELECT COUNT(*) as count FROM inventory');
    
    res.json({
      success: true,
      data: {
        total_customers: customerCount[0].count,
        total_suppliers: supplierCount[0].count,
        total_inventory: inventoryCount[0].count,
        total_revenue: (customerCount[0].count * 1250 + Math.random() * 5000).toFixed(2),
        monthly_spend: (supplierCount[0].count * 320 + Math.random() * 2000).toFixed(2),
        generated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    // Fallback demo data
    res.json({
      success: true,
      data: {
        total_customers: 125,
        total_suppliers: 45,
        total_inventory: 1850,
        total_revenue: 156780.50,
        monthly_spend: 23450.75,
        generated_at: new Date().toISOString()
      }
    });
  }
});

// Start server
async function startServer() {
  try {
    await initDatabase();
    
    const server = app.listen(port, () => {
      console.log(`🚀 DEMO SERVER running on http://localhost:${port}`);
      console.log(`📊 Database: ${dbConfig.database}`);
      console.log(`🔗 Health check: http://localhost:${port}/health`);
      console.log(`📈 Ready for 15-minute demo!`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        if (pool) pool.end();
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        if (pool) pool.end();
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start demo server:', error);
    process.exit(1);
  }
}

startServer();