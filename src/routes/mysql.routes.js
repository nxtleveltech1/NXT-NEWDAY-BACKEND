import express from 'express';
import { testMysqlConnection, getMysqlPoolStats, mysql_pool } from '../config/mysql.config.js';

const router = express.Router();

// Test MySQL connection endpoint
router.get('/test', async (req, res) => {
  try {
    const isConnected = await testMysqlConnection();
    const stats = getMysqlPoolStats();
    
    res.json({
      success: true,
      connected: isConnected,
      message: isConnected ? 'MySQL connection successful' : 'MySQL connection failed',
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      connected: false,
      message: 'MySQL connection test failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get MySQL database statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = getMysqlPoolStats();
    
    if (!mysql_pool) {
      return res.json({
        success: true,
        status: 'disabled',
        message: 'MySQL not configured',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      status: 'active',
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Simple query test endpoint
router.get('/query', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured',
        timestamp: new Date().toISOString()
      });
    }

    const connection = await mysql_pool.getConnection();
    const [results] = await connection.execute('SELECT DATABASE() as current_db, VERSION() as mysql_version, NOW() as current_time');
    connection.release();

    res.json({
      success: true,
      message: 'MySQL query successful',
      data: results[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'MySQL query failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Basic CRUD operations for testing
router.get('/users', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const connection = await mysql_pool.getConnection();
    
    // Create users table if it doesn't exist
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get all users
    const [users] = await connection.execute('SELECT * FROM users ORDER BY created_at DESC');
    connection.release();

    res.json({
      success: true,
      message: 'Users retrieved successfully',
      data: users,
      count: users.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve users',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Create a test user
router.post('/users', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const { name, email } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    const connection = await mysql_pool.getConnection();
    
    // Create users table if it doesn't exist
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert new user
    const [result] = await connection.execute(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      [name, email]
    );
    
    // Get the created user
    const [users] = await connection.execute(
      'SELECT * FROM users WHERE id = ?',
      [result.insertId]
    );
    
    connection.release();

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: users[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Analytics endpoints for dashboard
router.get('/analytics/revenue', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const connection = await mysql_pool.getConnection();
    
    // Create sample analytics tables if they don't exist
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT,
        total_amount DECIMAL(10,2),
        order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'completed'
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        price DECIMAL(10,2),
        stock_quantity INT DEFAULT 0,
        category VARCHAR(100)
      )
    `);

    // Insert sample data if empty
    const [orderCount] = await connection.execute('SELECT COUNT(*) as count FROM orders');
    if (orderCount[0].count === 0) {
      // Insert sample orders
      for (let i = 1; i <= 50; i++) {
        await connection.execute(
          'INSERT INTO orders (customer_id, total_amount, order_date) VALUES (?, ?, ?)',
          [
            Math.floor(Math.random() * 100) + 1,
            (Math.random() * 500 + 50).toFixed(2),
            new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
          ]
        );
      }
    }

    // Get total revenue
    const [revenue] = await connection.execute(`
      SELECT 
        SUM(total_amount) as totalRevenue,
        COUNT(*) as totalOrders,
        AVG(total_amount) as averageOrder
      FROM orders 
      WHERE status = 'completed'
    `);
    
    connection.release();

    res.json({
      success: true,
      totalRevenue: revenue[0].totalRevenue || 0,
      totalOrders: revenue[0].totalOrders || 0,
      averageOrder: revenue[0].averageOrder || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get revenue data',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/analytics/orders', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const connection = await mysql_pool.getConnection();
    const [orders] = await connection.execute(`
      SELECT COUNT(*) as totalOrders
      FROM orders 
      WHERE status = 'completed'
    `);
    connection.release();

    res.json({
      success: true,
      totalOrders: orders[0].totalOrders || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get orders data',
      error: error.message,
      totalOrders: 0
    });
  }
});

router.get('/analytics/customers', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const connection = await mysql_pool.getConnection();
    
    // Create customers table if not exists
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert sample customers if empty
    const [customerCount] = await connection.execute('SELECT COUNT(*) as count FROM customers');
    if (customerCount[0].count === 0) {
      const sampleCustomers = [
        'John Doe', 'Jane Smith', 'Bob Johnson', 'Alice Brown', 'Charlie Wilson',
        'Diana Davis', 'Eva Garcia', 'Frank Miller', 'Grace Lee', 'Henry Taylor'
      ];
      for (const name of sampleCustomers) {
        await connection.execute(
          'INSERT INTO customers (name, email) VALUES (?, ?)',
          [name, `${name.toLowerCase().replace(' ', '.')}@example.com`]
        );
      }
    }

    const [customers] = await connection.execute(`
      SELECT COUNT(*) as totalCustomers
      FROM customers
    `);
    connection.release();

    res.json({
      success: true,
      totalCustomers: customers[0].totalCustomers || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get customers data',
      error: error.message,
      totalCustomers: 0
    });
  }
});

router.get('/analytics/inventory', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const connection = await mysql_pool.getConnection();
    
    // Insert sample products if empty
    const [productCount] = await connection.execute('SELECT COUNT(*) as count FROM products');
    if (productCount[0].count === 0) {
      const sampleProducts = [
        ['Premium Widget', 99.99, 150, 'Electronics'],
        ['Standard Kit', 49.99, 200, 'Tools'],
        ['Deluxe Package', 149.99, 75, 'Electronics'],
        ['Basic Tool', 19.99, 300, 'Tools'],
        ['Professional Set', 199.99, 50, 'Professional']
      ];
      for (const [name, price, stock, category] of sampleProducts) {
        await connection.execute(
          'INSERT INTO products (name, price, stock_quantity, category) VALUES (?, ?, ?, ?)',
          [name, price, stock, category]
        );
      }
    }

    const [inventory] = await connection.execute(`
      SELECT SUM(price * stock_quantity) as totalValue
      FROM products
    `);
    connection.release();

    res.json({
      success: true,
      totalValue: inventory[0].totalValue || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get inventory data',
      error: error.message,
      totalValue: 0
    });
  }
});

router.get('/analytics/top-product', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const connection = await mysql_pool.getConnection();
    const [product] = await connection.execute(`
      SELECT name as productName
      FROM products
      ORDER BY (price * stock_quantity) DESC
      LIMIT 1
    `);
    connection.release();

    res.json({
      success: true,
      productName: product[0]?.productName || 'Premium Widget',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get top product',
      error: error.message,
      productName: 'Premium Widget'
    });
  }
});

router.get('/analytics/sales-trends', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({ success: false, message: 'MySQL not configured' });
    }

    const connection = await mysql_pool.getConnection();
    const [trends] = await connection.execute(`
      SELECT 
        DATE(order_date) as date,
        COUNT(*) as order_count,
        SUM(total_amount) as revenue,
        COUNT(*) as total_sales
      FROM orders 
      WHERE order_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(order_date)
      ORDER BY date DESC
    `);
    connection.release();

    res.json({ success: true, data: trends });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

router.get('/analytics/revenue-monthly', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({ success: false, message: 'MySQL not configured' });
    }

    const connection = await mysql_pool.getConnection();
    const [monthly] = await connection.execute(`
      SELECT 
        DATE_FORMAT(order_date, '%b') as month,
        SUM(total_amount) as total_revenue,
        SUM(total_amount * 0.35) as profit
      FROM orders 
      WHERE order_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY MONTH(order_date), DATE_FORMAT(order_date, '%b')
      ORDER BY MONTH(order_date)
    `);
    connection.release();

    res.json({ success: true, data: monthly });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

router.get('/analytics/product-performance', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({ success: false, message: 'MySQL not configured' });
    }

    const connection = await mysql_pool.getConnection();
    const [products] = await connection.execute(`
      SELECT 
        name as product_name,
        stock_quantity as total_sold,
        (price * stock_quantity) as revenue
      FROM products 
      ORDER BY revenue DESC
      LIMIT 10
    `);
    connection.release();

    res.json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

router.get('/analytics/inventory-turnover', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({ success: false, message: 'MySQL not configured' });
    }

    const connection = await mysql_pool.getConnection();
    const [turnover] = await connection.execute(`
      SELECT 
        category,
        AVG(stock_quantity) as current_stock,
        (COUNT(*) * 2.5) as turnover_rate
      FROM products 
      GROUP BY category
    `);
    connection.release();

    res.json({ success: true, data: turnover });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

router.get('/analytics/customer-segments', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({ success: false, message: 'MySQL not configured' });
    }

    const connection = await mysql_pool.getConnection();
    const [segments] = await connection.execute(`
      SELECT 
        CASE 
          WHEN c.id <= 2 THEN 'VIP'
          WHEN c.id <= 5 THEN 'Premium'
          WHEN c.id <= 8 THEN 'Standard'
          ELSE 'Basic'
        END as segment,
        COUNT(*) as customer_count,
        SUM(CASE 
          WHEN c.id <= 2 THEN 5000
          WHEN c.id <= 5 THEN 2000
          WHEN c.id <= 8 THEN 500
          ELSE 185
        END) as total_value
      FROM customers c
      GROUP BY segment
    `);
    connection.release();

    res.json({ success: true, data: segments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

// Inventory endpoints for live demo
router.get('/inventory', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const { page = 1, limit = 20, search = '', sortBy = 'name', sortOrder = 'asc' } = req.query;
    const offset = (page - 1) * limit;

    const connection = await mysql_pool.getConnection();
    
    // Create inventory table if it doesn't exist
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS inventory (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100) UNIQUE NOT NULL,
        quantity INT DEFAULT 0,
        minStock INT DEFAULT 0,
        maxStock INT DEFAULT 100,
        unitPrice DECIMAL(10,2) DEFAULT 0.00,
        category VARCHAR(100) DEFAULT 'General',
        supplier VARCHAR(255) DEFAULT '',
        status ENUM('active', 'inactive', 'discontinued') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Insert demo data if table is empty
    const [countResult] = await connection.execute('SELECT COUNT(*) as count FROM inventory');
    if (countResult[0].count === 0) {
      await connection.execute(`
        INSERT INTO inventory (name, sku, quantity, minStock, maxStock, unitPrice, category, supplier) VALUES
        ('Premium Coffee Beans - Colombian', 'COF-COL-001', 45, 10, 100, 24.99, 'Coffee', 'Colombian Farms Co.'),
        ('Espresso Machine - Professional', 'EQP-ESP-001', 3, 5, 20, 1299.99, 'Equipment', 'Coffee Tech Ltd'),
        ('Disposable Cups - 12oz', 'SUP-CUP-012', 0, 100, 1000, 0.15, 'Supplies', 'Packaging Plus'),
        ('Organic Tea Collection', 'TEA-ORG-001', 28, 15, 50, 18.50, 'Tea', 'Organic Harvest'),
        ('Milk Frother - Handheld', 'EQP-FRT-001', 12, 8, 30, 45.99, 'Equipment', 'Kitchen Pro'),
        ('Coffee Filters - Large', 'SUP-FIL-001', 12, 25, 200, 8.99, 'Supplies', 'Filter Co.'),
        ('Arabica Beans - Ethiopian', 'COF-ETH-001', 67, 15, 80, 28.50, 'Coffee', 'Ethiopian Imports'),
        ('Espresso Cups Set', 'SUP-CUP-ESP', 24, 10, 50, 34.99, 'Supplies', 'Ceramic Works'),
        ('Green Tea - Sencha', 'TEA-GRN-001', 19, 12, 40, 22.00, 'Tea', 'Tea Masters'),
        ('Coffee Grinder - Burr', 'EQP-GRN-001', 8, 5, 25, 189.99, 'Equipment', 'Grind Pro')
      `);
    }

    // Build search and sort query
    let whereClause = 'WHERE 1=1';
    let queryParams = [];
    
    if (search) {
      whereClause += ' AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const validSortFields = ['name', 'quantity', 'unitPrice', 'category', 'created_at'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    const sortDirection = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    // Get total count
    const [totalResult] = await connection.execute(
      `SELECT COUNT(*) as total FROM inventory ${whereClause}`,
      queryParams
    );
    const total = totalResult[0].total;

    // Get inventory items
    const [inventory] = await connection.execute(`
      SELECT 
        id, name, sku, quantity, minStock, maxStock, unitPrice,
        (quantity * unitPrice) as totalValue,
        category, supplier, status, updated_at as lastUpdated
      FROM inventory 
      ${whereClause}
      ORDER BY ${sortField} ${sortDirection}
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    connection.release();

    res.json({
      success: true,
      message: 'Inventory retrieved successfully',
      data: inventory,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve inventory',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get low stock items
router.get('/inventory/low-stock', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const connection = await mysql_pool.getConnection();
    
    const [lowStockItems] = await connection.execute(`
      SELECT 
        id, name, sku, quantity, minStock, unitPrice, category, supplier
      FROM inventory 
      WHERE quantity <= minStock AND status = 'active'
      ORDER BY quantity ASC
    `);

    connection.release();

    res.json({
      success: true,
      message: 'Low stock items retrieved successfully',
      data: lowStockItems,
      count: lowStockItems.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve low stock items',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Adjust stock
router.post('/inventory/:id/adjust', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const { id } = req.params;
    const { type, quantity, reason = 'Manual adjustment' } = req.body;

    if (!type || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'Type and quantity are required'
      });
    }

    const connection = await mysql_pool.getConnection();
    
    // Get current item
    const [items] = await connection.execute(
      'SELECT * FROM inventory WHERE id = ?',
      [id]
    );

    if (items.length === 0) {
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    const item = items[0];
    let newQuantity = item.quantity;

    if (type === 'increase') {
      newQuantity += parseInt(quantity);
    } else if (type === 'decrease') {
      newQuantity = Math.max(0, newQuantity - parseInt(quantity));
    } else {
      newQuantity = parseInt(quantity);
    }

    // Update inventory
    await connection.execute(
      'UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newQuantity, id]
    );

    // Get updated item
    const [updatedItems] = await connection.execute(
      'SELECT * FROM inventory WHERE id = ?',
      [id]
    );

    connection.release();

    res.json({
      success: true,
      message: 'Stock adjusted successfully',
      data: updatedItems[0],
      adjustment: {
        type,
        quantity: parseInt(quantity),
        oldQuantity: item.quantity,
        newQuantity,
        reason
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to adjust stock',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Suppliers CRUD endpoints
router.get('/suppliers', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const { page = 1, limit = 10, search = '' } = req.query;
    const offset = (page - 1) * limit;

    const connection = await mysql_pool.getConnection();
    
    // Create suppliers table if it doesn't exist
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL,
        contact_person VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        status ENUM('active', 'inactive', 'pending', 'suspended') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Insert sample data if table is empty
    const [countResult] = await connection.execute('SELECT COUNT(*) as count FROM suppliers');
    if (countResult[0].count === 0) {
      await connection.execute(`
        INSERT INTO suppliers (company_name, contact_person, email, phone, address, status) VALUES
        ('TechParts Solutions', 'John Smith', 'john@techparts.com', '+1 (555) 123-4567', '123 Tech Street, Silicon Valley, CA 94043', 'active'),
        ('Global Components Inc', 'Sarah Johnson', 'sarah@globalcomponents.com', '+1 (555) 987-6543', '456 Industrial Ave, Detroit, MI 48201', 'active'),
        ('Precision Manufacturing', 'Mike Chen', 'mike@precision-mfg.com', '+1 (555) 456-7890', '789 Factory Rd, Houston, TX 77001', 'pending'),
        ('Quality Electronics Ltd', 'Emma Wilson', 'emma@qualityelec.com', '+1 (555) 321-9876', '321 Circuit Blvd, Austin, TX 78701', 'active'),
        ('Rapid Supply Chain', 'David Rodriguez', 'david@rapidsupply.com', '+1 (555) 654-3210', '654 Logistics Lane, Phoenix, AZ 85001', 'suspended')
      `);
    }

    let query = 'SELECT * FROM suppliers';
    let queryParams = [];

    if (search) {
      query += ' WHERE company_name LIKE ? OR contact_person LIKE ? OR email LIKE ?';
      queryParams = [`%${search}%`, `%${search}%`, `%${search}%`];
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    queryParams.push(parseInt(limit), parseInt(offset));

    const [suppliers] = await connection.execute(query, queryParams);
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM suppliers';
    let countParams = [];
    if (search) {
      countQuery += ' WHERE company_name LIKE ? OR contact_person LIKE ? OR email LIKE ?';
      countParams = [`%${search}%`, `%${search}%`, `%${search}%`];
    }
    const [totalResult] = await connection.execute(countQuery, countParams);
    const total = totalResult[0].total;

    connection.release();

    res.json({
      success: true,
      data: suppliers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve suppliers',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get single supplier
router.get('/suppliers/:id', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const { id } = req.params;
    const connection = await mysql_pool.getConnection();
    
    const [suppliers] = await connection.execute(
      'SELECT * FROM suppliers WHERE id = ?',
      [id]
    );
    
    connection.release();

    if (suppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    res.json({
      success: true,
      data: suppliers[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve supplier',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Create supplier
router.post('/suppliers', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const { company_name, contact_person, email, phone, address, status = 'pending' } = req.body;
    
    if (!company_name) {
      return res.status(400).json({
        success: false,
        message: 'Company name is required'
      });
    }

    const connection = await mysql_pool.getConnection();
    
    const [result] = await connection.execute(
      'INSERT INTO suppliers (company_name, contact_person, email, phone, address, status) VALUES (?, ?, ?, ?, ?, ?)',
      [company_name, contact_person, email, phone, address, status]
    );
    
    const [suppliers] = await connection.execute(
      'SELECT * FROM suppliers WHERE id = ?',
      [result.insertId]
    );
    
    connection.release();

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: suppliers[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create supplier',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Update supplier
router.put('/suppliers/:id', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const { id } = req.params;
    const { company_name, contact_person, email, phone, address, status } = req.body;
    
    const connection = await mysql_pool.getConnection();
    
    const [result] = await connection.execute(
      'UPDATE suppliers SET company_name = ?, contact_person = ?, email = ?, phone = ?, address = ?, status = ? WHERE id = ?',
      [company_name, contact_person, email, phone, address, status, id]
    );
    
    if (result.affectedRows === 0) {
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    
    const [suppliers] = await connection.execute(
      'SELECT * FROM suppliers WHERE id = ?',
      [id]
    );
    
    connection.release();

    res.json({
      success: true,
      message: 'Supplier updated successfully',
      data: suppliers[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update supplier',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Delete supplier
router.delete('/suppliers/:id', async (req, res) => {
  try {
    if (!mysql_pool) {
      return res.status(503).json({
        success: false,
        message: 'MySQL not configured'
      });
    }

    const { id } = req.params;
    const connection = await mysql_pool.getConnection();
    
    const [result] = await connection.execute(
      'DELETE FROM suppliers WHERE id = ?',
      [id]
    );
    
    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    res.json({
      success: true,
      message: 'Supplier deleted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete supplier',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;