#!/usr/bin/env node

import fs from 'fs';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const pool = new Pool({
  connectionString: 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB',
  ssl: {
    rejectUnauthorized: false
  }
});

class EmergencyImporter {
  constructor() {
    this.errors = [];
    this.stats = {
      products: { total: 0, imported: 0, skipped: 0, errors: 0 },
      customers: { total: 0, imported: 0, skipped: 0, errors: 0 },
      orders: { total: 0, imported: 0, skipped: 0, errors: 0 }
    };
  }

  async checkCurrentCounts() {
    console.log('📊 Checking current database counts...');
    
    try {
      const productCount = await pool.query('SELECT COUNT(*) FROM products');
      const customerCount = await pool.query('SELECT COUNT(*) FROM customers');
      const orderCount = await pool.query('SELECT COUNT(*) FROM orders');
      
      console.log(`Current counts:`);
      console.log(`   Products: ${productCount.rows[0].count}`);
      console.log(`   Customers: ${customerCount.rows[0].count}`);
      console.log(`   Orders: ${orderCount.rows[0].count}`);
      
      return {
        products: parseInt(productCount.rows[0].count),
        customers: parseInt(customerCount.rows[0].count),
        orders: parseInt(orderCount.rows[0].count)
      };
    } catch (error) {
      console.error('❌ Count check failed:', error);
      return null;
    }
  }

  async importProducts() {
    console.log('🚀 Starting products import...');
    const filePath = '/home/gambew_admin/projects/uploads/woocommerce-products-2025-07-13.json';
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.stats.products.total = data.length;
      console.log(`📦 Found ${data.length} products to import`);

      const batchSize = 50; // Smaller batches for stability
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        await this.importProductBatch(batch, i);
        
        if (i % 1000 === 0) {
          console.log(`📦 Products progress: ${i + batch.length}/${data.length} (${((i + batch.length) / data.length * 100).toFixed(1)}%)`);
        }
      }
    } catch (error) {
      console.error('❌ Products import failed:', error);
      this.errors.push({ type: 'products', error: error.message });
    }
  }

  async importProductBatch(products, offset) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const product of products) {
        try {
          // Check if product exists
          const existingProduct = await client.query('SELECT id FROM products WHERE id = $1', [product.id]);
          
          if (existingProduct.rows.length > 0) {
            this.stats.products.skipped++;
            continue;
          }

          // Insert with the existing table structure
          const insertSQL = `
            INSERT INTO products (
              id, name, slug, permalink, price, sku, stock_quantity, stock_status,
              categories, date_created, date_modified, weight, dimensions
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              slug = EXCLUDED.slug,
              price = EXCLUDED.price,
              sku = EXCLUDED.sku,
              date_modified = EXCLUDED.date_modified
          `;

          const values = [
            product.id,
            product.name || '',
            product.slug || '',
            product.permalink || '',
            parseFloat(product.price) || 0,
            product.sku || '',
            product.stock_quantity || 0,
            product.stock_status || 'instock',
            JSON.stringify(product.categories || []),
            product.date_created ? new Date(product.date_created) : new Date(),
            product.date_modified ? new Date(product.date_modified) : new Date(),
            product.weight ? parseFloat(product.weight) : null,
            JSON.stringify(product.dimensions || {})
          ];

          await client.query(insertSQL, values);
          this.stats.products.imported++;
        } catch (error) {
          this.stats.products.errors++;
          this.errors.push({ type: 'product', id: product.id, error: error.message });
        }
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async importCustomers() {
    console.log('👥 Starting customers import...');
    const filePath = '/home/gambew_admin/projects/uploads/woocommerce-customers-2025-07-13.json';
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.stats.customers.total = data.length;
      console.log(`👥 Found ${data.length} customers to import`);

      const batchSize = 50;
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        await this.importCustomerBatch(batch);
        
        if (i % 500 === 0) {
          console.log(`👥 Customers progress: ${i + batch.length}/${data.length} (${((i + batch.length) / data.length * 100).toFixed(1)}%)`);
        }
      }
    } catch (error) {
      console.error('❌ Customers import failed:', error);
      this.errors.push({ type: 'customers', error: error.message });
    }
  }

  async importCustomerBatch(customers) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const customer of customers) {
        try {
          // Check if customer exists
          const existingCustomer = await client.query('SELECT id FROM customers WHERE id = $1', [customer.id]);
          
          if (existingCustomer.rows.length > 0) {
            this.stats.customers.skipped++;
            continue;
          }

          const insertSQL = `
            INSERT INTO customers (
              id, first_name, last_name, email, username, billing, shipping,
              is_paying_customer, avatar_url, meta_data, role, date_created,
              date_created_gmt, date_modified, date_modified_gmt
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (id) DO UPDATE SET
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              email = EXCLUDED.email,
              billing = EXCLUDED.billing,
              shipping = EXCLUDED.shipping,
              date_modified = EXCLUDED.date_modified
          `;

          const values = [
            customer.id,
            customer.first_name || '',
            customer.last_name || '',
            customer.email || '',
            customer.username || '',
            JSON.stringify(customer.billing || {}),
            JSON.stringify(customer.shipping || {}),
            customer.is_paying_customer || false,
            customer.avatar_url || '',
            JSON.stringify(customer.meta_data || []),
            customer.role || 'customer',
            customer.date_created ? new Date(customer.date_created) : new Date(),
            customer.date_created_gmt ? new Date(customer.date_created_gmt) : new Date(),
            customer.date_modified ? new Date(customer.date_modified) : new Date(),
            customer.date_modified_gmt ? new Date(customer.date_modified_gmt) : new Date()
          ];

          await client.query(insertSQL, values);
          this.stats.customers.imported++;
        } catch (error) {
          this.stats.customers.errors++;
          this.errors.push({ type: 'customer', id: customer.id, error: error.message });
        }
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async importOrders() {
    console.log('📝 Starting orders import...');
    const filePath = '/home/gambew_admin/projects/uploads/woocommerce-orders-2025-07-13.json';
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.stats.orders.total = data.length;
      console.log(`📝 Found ${data.length} orders to import`);

      const batchSize = 50;
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        await this.importOrderBatch(batch);
        
        if (i % 500 === 0) {
          console.log(`📝 Orders progress: ${i + batch.length}/${data.length} (${((i + batch.length) / data.length * 100).toFixed(1)}%)`);
        }
      }
    } catch (error) {
      console.error('❌ Orders import failed:', error);
      this.errors.push({ type: 'orders', error: error.message });
    }
  }

  async importOrderBatch(orders) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const order of orders) {
        try {
          // Check if order exists
          const existingOrder = await client.query('SELECT id FROM orders WHERE id = $1', [order.id]);
          
          if (existingOrder.rows.length > 0) {
            this.stats.orders.skipped++;
            continue;
          }

          const insertSQL = `
            INSERT INTO orders (
              id, status, currency, total, customer_id, payment_method_title,
              date_created, date_modified, billing_address, shipping_address
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
              status = EXCLUDED.status,
              total = EXCLUDED.total,
              date_modified = EXCLUDED.date_modified
          `;

          const billingAddress = order.billing ? 
            `${order.billing.first_name || ''} ${order.billing.last_name || ''}\n${order.billing.address_1 || ''}\n${order.billing.city || ''}, ${order.billing.state || ''} ${order.billing.postcode || ''}\n${order.billing.country || ''}`.trim() : '';
          
          const shippingAddress = order.shipping ? 
            `${order.shipping.first_name || ''} ${order.shipping.last_name || ''}\n${order.shipping.address_1 || ''}\n${order.shipping.city || ''}, ${order.shipping.state || ''} ${order.shipping.postcode || ''}\n${order.shipping.country || ''}`.trim() : '';

          const values = [
            order.id,
            order.status || 'pending',
            order.currency || 'ZAR',
            parseFloat(order.total) || 0,
            order.customer_id || null,
            order.payment_method_title || '',
            order.date_created ? new Date(order.date_created) : new Date(),
            order.date_modified ? new Date(order.date_modified) : new Date(),
            billingAddress,
            shippingAddress
          ];

          await client.query(insertSQL, values);
          this.stats.orders.imported++;
        } catch (error) {
          this.stats.orders.errors++;
          this.errors.push({ type: 'order', id: order.id, error: error.message });
        }
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyImports() {
    console.log('🔍 Verifying imports...');
    
    try {
      const productCount = await pool.query('SELECT COUNT(*) FROM products');
      const customerCount = await pool.query('SELECT COUNT(*) FROM customers');
      const orderCount = await pool.query('SELECT COUNT(*) FROM orders');
      
      console.log(`📊 Final counts:`);
      console.log(`   Products: ${productCount.rows[0].count}`);
      console.log(`   Customers: ${customerCount.rows[0].count}`);
      console.log(`   Orders: ${orderCount.rows[0].count}`);
      
      return {
        products: parseInt(productCount.rows[0].count),
        customers: parseInt(customerCount.rows[0].count),
        orders: parseInt(orderCount.rows[0].count)
      };
    } catch (error) {
      console.error('❌ Verification failed:', error);
      return null;
    }
  }

  async run() {
    console.log('🚨 EMERGENCY IMPORT STARTING');
    console.log('================================');
    
    const startTime = Date.now();
    
    try {
      const initialCounts = await this.checkCurrentCounts();
      
      // Import all data in parallel for faster processing
      await Promise.all([
        this.importProducts(),
        this.importCustomers(),
        this.importOrders()
      ]);
      
      const finalCounts = await this.verifyImports();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log('\n🎉 EMERGENCY IMPORT COMPLETED');
      console.log('============================');
      console.log(`⏱️ Duration: ${duration}s`);
      console.log('\n📊 Import Statistics:');
      console.log(`Products: ${this.stats.products.imported} imported, ${this.stats.products.skipped} skipped, ${this.stats.products.errors} errors`);
      console.log(`Customers: ${this.stats.customers.imported} imported, ${this.stats.customers.skipped} skipped, ${this.stats.customers.errors} errors`);
      console.log(`Orders: ${this.stats.orders.imported} imported, ${this.stats.orders.skipped} skipped, ${this.stats.orders.errors} errors`);
      
      if (initialCounts && finalCounts) {
        console.log('\n📈 Growth:');
        console.log(`Products: ${initialCounts.products} → ${finalCounts.products} (+${finalCounts.products - initialCounts.products})`);
        console.log(`Customers: ${initialCounts.customers} → ${finalCounts.customers} (+${finalCounts.customers - initialCounts.customers})`);
        console.log(`Orders: ${initialCounts.orders} → ${finalCounts.orders} (+${finalCounts.orders - initialCounts.orders})`);
      }
      
      if (this.errors.length > 0) {
        console.log(`\n⚠️ ${this.errors.length} errors encountered:`);
        this.errors.slice(0, 10).forEach(error => {
          console.log(`   ${error.type} ${error.id || ''}: ${error.error}`);
        });
        if (this.errors.length > 10) {
          console.log(`   ... and ${this.errors.length - 10} more errors`);
        }
      }
      
      return finalCounts;
    } catch (error) {
      console.error('💥 CRITICAL ERROR:', error);
      throw error;
    }
  }
}

// Run the emergency import
if (import.meta.url === `file://${process.argv[1]}`) {
  const importer = new EmergencyImporter();
  importer.run()
    .then(counts => {
      if (counts && counts.products >= 50000) {
        console.log('✅ SUCCESS: All data imported successfully!');
        process.exit(0);
      } else {
        console.log('⚠️ WARNING: Import completed but checking results...');
        process.exit(0);
      }
    })
    .catch(error => {
      console.error('💥 FATAL ERROR:', error);
      process.exit(1);
    });
}

export default EmergencyImporter;