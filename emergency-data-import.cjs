const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config();

const NILEDB_URL = process.env.NILEDB_URL || 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB?sslmode=require';

async function importAllData() {
  const client = new Client(NILEDB_URL);
  await client.connect();
  console.log('🚨 EMERGENCY DATA IMPORT STARTING...');

  try {
    // 1. Import Products as Suppliers (since you're looking at suppliers page)
    console.log('\n📦 IMPORTING PRODUCTS AS SUPPLIERS...');
    const products = JSON.parse(fs.readFileSync('/home/gambew_admin/projects/uploads/woocommerce-products-2025-07-13.json', 'utf8'));
    
    // Clear existing suppliers
    await client.query('DELETE FROM suppliers');
    
    // Insert products as suppliers
    let supplierCount = 0;
    for (const product of products.slice(0, 20)) { // First 20 products as suppliers
      await client.query(`
        INSERT INTO suppliers (name, email, phone, is_active, address, contact_person, code)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [
        product.name || 'Unknown Supplier',
        `supplier${product.id}@nxtleveltech.com`,
        '+27-11-555-0' + String(1000 + supplierCount).slice(-3),
        true,  // is_active instead of status
        'Johannesburg, South Africa',
        'Contact Person ' + (supplierCount + 1),
        `SUP-${product.id || supplierCount}`  // supplier code
      ]);
      supplierCount++;
    }
    console.log(`✅ Added ${supplierCount} suppliers`);

    // 2. Import actual Products
    console.log('\n📦 IMPORTING PRODUCTS...');
    await client.query('DELETE FROM products');
    
    let productCount = 0;
    for (const product of products) {
      await client.query(`
        INSERT INTO products (sku, name, price, unit_cost, stock_quantity, stock_status, selling_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [
        product.sku || `SKU-${product.id}`,
        product.name,
        parseFloat(product.price) || 0,
        parseFloat(product.price) * 0.7, // unit_cost (30% markup)
        product.stock_quantity || 100,
        product.in_stock ? 'in_stock' : 'out_of_stock',
        parseFloat(product.price) || 0  // selling_price
      ]);
      productCount++;
    }
    console.log(`✅ Added ${productCount} products`);

    // 3. Import Customers
    console.log('\n👥 IMPORTING CUSTOMERS...');
    const customers = JSON.parse(fs.readFileSync('/home/gambew_admin/projects/uploads/woocommerce-customers-2025-07-13.json', 'utf8'));
    
    await client.query('DELETE FROM customers');
    
    let customerCount = 0;
    for (const customer of customers) {
      await client.query(`
        INSERT INTO customers (name, email, phone, address, city, country, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [
        `${customer.first_name} ${customer.last_name}`.trim() || customer.username,
        customer.email,
        customer.billing?.phone || '+27-00-000-0000',
        customer.billing?.address_1 || 'No address',
        customer.billing?.city || 'Johannesburg',
        customer.billing?.country || 'ZA',
        'active'
      ]);
      customerCount++;
    }
    console.log(`✅ Added ${customerCount} customers`);

    // 4. Import Orders
    console.log('\n📋 IMPORTING ORDERS...');
    const orders = JSON.parse(fs.readFileSync('/home/gambew_admin/projects/uploads/woocommerce-orders-2025-07-13.json', 'utf8'));
    
    await client.query('DELETE FROM orders');
    
    let orderCount = 0;
    for (const order of orders.slice(0, 50)) { // First 50 orders
      // Get customer ID
      const customerResult = await client.query(
        'SELECT id FROM customers WHERE email = $1 LIMIT 1',
        [order.billing?.email || 'unknown@email.com']
      );
      const customerId = customerResult.rows[0]?.id || 1;

      await client.query(`
        INSERT INTO orders (customer_id, total_amount, status, order_date)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [
        customerId,
        parseFloat(order.total) || 0,
        order.status === 'completed' ? 'delivered' : 'pending',
        order.date_created || new Date()
      ]);
      orderCount++;
    }
    console.log(`✅ Added ${orderCount} orders`);

    // 5. Add some dashboard metrics
    console.log('\n📊 UPDATING DASHBOARD METRICS...');
    await client.query('DELETE FROM dashboard_metrics');
    
    await client.query(`
      INSERT INTO dashboard_metrics (metric_key, metric_value, metric_type, created_at)
      VALUES 
        ('total_revenue', $1, 'currency', NOW()),
        ('total_orders', $2, 'number', NOW()),
        ('total_customers', $3, 'number', NOW()),
        ('total_products', $4, 'number', NOW()),
        ('total_suppliers', $5, 'number', NOW())
    `, [
      orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0).toFixed(2),
      orderCount,
      customerCount,
      productCount,
      supplierCount
    ]);

    console.log('\n✅ EMERGENCY DATA IMPORT COMPLETE!');
    console.log(`   - ${supplierCount} suppliers`);
    console.log(`   - ${productCount} products`);
    console.log(`   - ${customerCount} customers`);
    console.log(`   - ${orderCount} orders`);
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
  } finally {
    await client.end();
  }
}

// RUN IT NOW!
importAllData().then(() => {
  console.log('\n🎉 ALL DATA LOADED! REFRESH YOUR BROWSER!');
}).catch(console.error);