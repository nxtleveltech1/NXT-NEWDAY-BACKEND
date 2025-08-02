const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const NILEDB_URL = 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB?sslmode=require';

async function importAllData() {
  const client = new Client(NILEDB_URL);
  
  try {
    await client.connect();
    console.log('✅ Connected to NILEDB');
    
    // Import Products
    console.log('\n📦 Importing Products...');
    const productsData = JSON.parse(fs.readFileSync('/home/gambew_admin/projects/uploads/woocommerce-products-2025-07-13.json', 'utf8'));
    console.log(`Found ${productsData.length} products to import`);
    
    let productCount = 0;
    for (const product of productsData) {
      try {
        await client.query(
          `INSERT INTO products (
            id, sku, name, price, unit_cost, stock_quantity, 
            stock_status, selling_price
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7
          ) ON CONFLICT (sku) DO UPDATE SET
            name = EXCLUDED.name,
            price = EXCLUDED.price,
            stock_quantity = EXCLUDED.stock_quantity`,
          [
            product.sku || `PROD-${product.id}`,
            product.name || product.title,
            parseFloat(product.price) || 0,
            parseFloat(product.cost || product.price) * 0.6,
            parseInt(product.stock_quantity) || 0,
            product.stock_status || 'instock',
            parseFloat(product.price) || 0
          ]
        );
        productCount++;
        if (productCount % 100 === 0) {
          console.log(`  Imported ${productCount} products...`);
        }
      } catch (err) {
        console.error(`Error importing product ${product.sku}:`, err.message);
      }
    }
    console.log(`✅ Imported ${productCount} products`);
    
    // Import Customers
    console.log('\n👥 Importing Customers...');
    const customersData = JSON.parse(fs.readFileSync('/home/gambew_admin/projects/uploads/woocommerce-customers-2025-07-13.json', 'utf8'));
    console.log(`Found ${customersData.length} customers to import`);
    
    let customerCount = 0;
    for (const customer of customersData) {
      try {
        await client.query(
          `INSERT INTO customers (
            id, name, email, phone, address, city, state, 
            country, postal_code, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
          ) ON CONFLICT (email) DO UPDATE SET
            name = EXCLUDED.name,
            phone = EXCLUDED.phone,
            updated_at = NOW()`,
          [
            customer.first_name + ' ' + customer.last_name,
            customer.email,
            customer.phone || customer.billing?.phone || '',
            customer.billing?.address_1 || '',
            customer.billing?.city || '',
            customer.billing?.state || '',
            customer.billing?.country || '',
            customer.billing?.postcode || ''
          ]
        );
        customerCount++;
        if (customerCount % 100 === 0) {
          console.log(`  Imported ${customerCount} customers...`);
        }
      } catch (err) {
        console.error(`Error importing customer ${customer.email}:`, err.message);
      }
    }
    console.log(`✅ Imported ${customerCount} customers`);
    
    // Import Orders
    console.log('\n📋 Importing Orders...');
    const ordersData = JSON.parse(fs.readFileSync('/home/gambew_admin/projects/uploads/woocommerce-orders-2025-07-13.json', 'utf8'));
    console.log(`Found ${ordersData.length} orders to import`);
    
    let orderCount = 0;
    for (const order of ordersData) {
      try {
        // Get customer ID
        const customerResult = await client.query(
          'SELECT id FROM customers WHERE email = $1',
          [order.billing?.email || 'unknown@email.com']
        );
        const customerId = customerResult.rows[0]?.id;
        
        if (customerId) {
          await client.query(
            `INSERT INTO orders (
              id, order_number, customer_id, status, total_amount,
              shipping_amount, tax_amount, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW()
            ) ON CONFLICT (order_number) DO UPDATE SET
              status = EXCLUDED.status,
              total_amount = EXCLUDED.total_amount,
              updated_at = NOW()`,
            [
              order.number || order.id.toString(),
              customerId,
              order.status || 'pending',
              parseFloat(order.total) || 0,
              parseFloat(order.shipping_total) || 0,
              parseFloat(order.total_tax) || 0,
              order.date_created || new Date()
            ]
          );
          orderCount++;
          if (orderCount % 50 === 0) {
            console.log(`  Imported ${orderCount} orders...`);
          }
        }
      } catch (err) {
        console.error(`Error importing order ${order.number}:`, err.message);
      }
    }
    console.log(`✅ Imported ${orderCount} orders`);
    
    // Final counts
    const productTotal = await client.query('SELECT COUNT(*) FROM products');
    const customerTotal = await client.query('SELECT COUNT(*) FROM customers');
    const orderTotal = await client.query('SELECT COUNT(*) FROM orders');
    
    console.log('\n📊 FINAL DATABASE COUNTS:');
    console.log(`  Products: ${productTotal.rows[0].count}`);
    console.log(`  Customers: ${customerTotal.rows[0].count}`);
    console.log(`  Orders: ${orderTotal.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Import failed:', error);
  } finally {
    await client.end();
  }
}

importAllData();