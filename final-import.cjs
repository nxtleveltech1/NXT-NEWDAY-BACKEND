const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const NILEDB_URL = 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB?sslmode=require';

async function importData() {
  const client = new Client(NILEDB_URL);
  
  try {
    await client.connect();
    console.log('✅ Connected to NILEDB\n');
    
    // Get current counts
    const productCount = await client.query('SELECT COUNT(*) FROM products');
    const customerCount = await client.query('SELECT COUNT(*) FROM customers');
    const orderCount = await client.query('SELECT COUNT(*) FROM orders');
    
    console.log('📊 Current Database Status:');
    console.log(`  Products: ${productCount.rows[0].count}`);
    console.log(`  Customers: ${customerCount.rows[0].count}`);
    console.log(`  Orders: ${orderCount.rows[0].count}\n`);
    
    // Import Products
    console.log('📦 Importing Products...');
    const productsData = JSON.parse(fs.readFileSync('/home/gambew_admin/projects/uploads/woocommerce-products-2025-07-13.json', 'utf8'));
    console.log(`  Found ${productsData.length} products in JSON`);
    
    let newProducts = 0;
    for (const product of productsData) {
      try {
        // Check if product exists
        const exists = await client.query('SELECT id FROM products WHERE sku = $1', [product.sku || `PROD-${product.id}`]);
        
        if (exists.rows.length === 0) {
          await client.query(
            `INSERT INTO products (sku, name, price, unit_cost, stock_quantity, stock_status, selling_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              product.sku || `PROD-${product.id}`,
              product.name || product.title || 'Unknown Product',
              parseFloat(product.price) || 0,
              parseFloat(product.cost || product.price) * 0.6 || 0,
              parseInt(product.stock_quantity) || 0,
              product.stock_status || 'instock',
              parseFloat(product.price) || 0
            ]
          );
          newProducts++;
          if (newProducts % 100 === 0) {
            console.log(`  Added ${newProducts} new products...`);
          }
        }
      } catch (err) {
        // Skip errors
      }
    }
    console.log(`  ✅ Added ${newProducts} new products\n`);
    
    // Import Customers
    console.log('👥 Importing Customers...');
    const customersData = JSON.parse(fs.readFileSync('/home/gambew_admin/projects/uploads/woocommerce-customers-2025-07-13.json', 'utf8'));
    console.log(`  Found ${customersData.length} customers in JSON`);
    
    let newCustomers = 0;
    for (const customer of customersData) {
      try {
        const email = customer.email || `customer${customer.id}@nxtdotx.co.za`;
        const exists = await client.query('SELECT id FROM customers WHERE email = $1', [email]);
        
        if (exists.rows.length === 0) {
          await client.query(
            `INSERT INTO customers (name, email, phone, address, city, state, country, postal_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              (customer.first_name || '') + ' ' + (customer.last_name || ''),
              email,
              customer.phone || customer.billing?.phone || '',
              customer.billing?.address_1 || '',
              customer.billing?.city || '',
              customer.billing?.state || '',
              customer.billing?.country || 'ZA',
              customer.billing?.postcode || ''
            ]
          );
          newCustomers++;
        }
      } catch (err) {
        // Skip errors
      }
    }
    console.log(`  ✅ Added ${newCustomers} new customers\n`);
    
    // Final counts
    const finalProducts = await client.query('SELECT COUNT(*) FROM products');
    const finalCustomers = await client.query('SELECT COUNT(*) FROM customers');
    const finalOrders = await client.query('SELECT COUNT(*) FROM orders');
    
    console.log('📊 FINAL Database Status:');
    console.log(`  Products: ${finalProducts.rows[0].count}`);
    console.log(`  Customers: ${finalCustomers.rows[0].count}`);
    console.log(`  Orders: ${finalOrders.rows[0].count}`);
    console.log(`\n✅ IMPORT COMPLETE!`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

importData();