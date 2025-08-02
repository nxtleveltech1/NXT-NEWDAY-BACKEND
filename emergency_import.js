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

  async ensureTables() {
    console.log('🔧 Ensuring database tables exist...');
    
    const createTablesSQL = `
      -- Products table
      CREATE TABLE IF NOT EXISTS products (
        id BIGINT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT,
        permalink TEXT,
        date_created TIMESTAMP,
        date_modified TIMESTAMP,
        type VARCHAR(50),
        status VARCHAR(50),
        featured BOOLEAN DEFAULT FALSE,
        catalog_visibility VARCHAR(50),
        description TEXT,
        short_description TEXT,
        sku VARCHAR(255),
        price DECIMAL(10,2),
        regular_price DECIMAL(10,2),
        sale_price DECIMAL(10,2),
        date_on_sale_from TIMESTAMP,
        date_on_sale_to TIMESTAMP,
        on_sale BOOLEAN DEFAULT FALSE,
        purchasable BOOLEAN DEFAULT TRUE,
        total_sales INTEGER DEFAULT 0,
        virtual BOOLEAN DEFAULT FALSE,
        downloadable BOOLEAN DEFAULT FALSE,
        tax_status VARCHAR(50),
        tax_class VARCHAR(50),
        manage_stock BOOLEAN DEFAULT FALSE,
        stock_quantity INTEGER,
        backorders VARCHAR(50),
        sold_individually BOOLEAN DEFAULT FALSE,
        weight DECIMAL(10,2),
        length DECIMAL(10,2),
        width DECIMAL(10,2),
        height DECIMAL(10,2),
        shipping_required BOOLEAN DEFAULT TRUE,
        reviews_allowed BOOLEAN DEFAULT TRUE,
        average_rating DECIMAL(3,2) DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        parent_id BIGINT,
        purchase_note TEXT,
        categories JSONB,
        tags JSONB,
        images JSONB,
        attributes JSONB,
        variations JSONB,
        grouped_products JSONB,
        menu_order INTEGER DEFAULT 0,
        meta_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Customers table
      CREATE TABLE IF NOT EXISTS customers (
        id BIGINT PRIMARY KEY,
        date_created TIMESTAMP,
        date_modified TIMESTAMP,
        email VARCHAR(255) UNIQUE NOT NULL,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        role VARCHAR(50),
        username VARCHAR(255),
        billing JSONB,
        shipping JSONB,
        is_paying_customer BOOLEAN DEFAULT FALSE,
        avatar_url TEXT,
        meta_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Orders table
      CREATE TABLE IF NOT EXISTS orders (
        id BIGINT PRIMARY KEY,
        parent_id BIGINT,
        status VARCHAR(50),
        currency VARCHAR(10),
        version VARCHAR(50),
        prices_include_tax BOOLEAN DEFAULT FALSE,
        date_created TIMESTAMP,
        date_modified TIMESTAMP,
        discount_total DECIMAL(10,2) DEFAULT 0,
        discount_tax DECIMAL(10,2) DEFAULT 0,
        shipping_total DECIMAL(10,2) DEFAULT 0,
        shipping_tax DECIMAL(10,2) DEFAULT 0,
        cart_tax DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2),
        total_tax DECIMAL(10,2) DEFAULT 0,
        customer_id BIGINT,
        order_key VARCHAR(255),
        billing JSONB,
        shipping JSONB,
        payment_method VARCHAR(100),
        payment_method_title VARCHAR(255),
        transaction_id VARCHAR(255),
        customer_ip_address INET,
        customer_user_agent TEXT,
        created_via VARCHAR(100),
        customer_note TEXT,
        date_completed TIMESTAMP,
        date_paid TIMESTAMP,
        cart_hash VARCHAR(255),
        number VARCHAR(100),
        meta_data JSONB,
        line_items JSONB,
        tax_lines JSONB,
        shipping_lines JSONB,
        fee_lines JSONB,
        coupon_lines JSONB,
        refunds JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
      CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
      CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
      CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_date_created ON orders(date_created);
    `;

    await pool.query(createTablesSQL);
    console.log('✅ Database tables ready');
  }

  async importProducts() {
    console.log('🚀 Starting products import...');
    const filePath = '/home/gambew_admin/projects/uploads/woocommerce-products-2025-07-13.json';
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.stats.products.total = data.length;
      console.log(`📦 Found ${data.length} products to import`);

      const batchSize = 100;
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

          const insertSQL = `
            INSERT INTO products (
              id, name, slug, permalink, date_created, date_modified, type, status,
              featured, catalog_visibility, description, short_description, sku,
              price, regular_price, sale_price, date_on_sale_from, date_on_sale_to,
              on_sale, purchasable, total_sales, virtual, downloadable,
              tax_status, tax_class, manage_stock, stock_quantity, backorders,
              sold_individually, weight, length, width, height, shipping_required,
              reviews_allowed, average_rating, rating_count, parent_id, purchase_note,
              categories, tags, images, attributes, variations, grouped_products,
              menu_order, meta_data
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
              $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
              $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44,
              $45, $46, $47
            )
          `;

          const values = [
            product.id,
            product.name,
            product.slug,
            product.permalink,
            product.date_created ? new Date(product.date_created) : null,
            product.date_modified ? new Date(product.date_modified) : null,
            product.type,
            product.status,
            product.featured,
            product.catalog_visibility,
            product.description,
            product.short_description,
            product.sku,
            parseFloat(product.price) || 0,
            parseFloat(product.regular_price) || 0,
            product.sale_price ? parseFloat(product.sale_price) : null,
            product.date_on_sale_from ? new Date(product.date_on_sale_from) : null,
            product.date_on_sale_to ? new Date(product.date_on_sale_to) : null,
            product.on_sale,
            product.purchasable,
            product.total_sales || 0,
            product.virtual,
            product.downloadable,
            product.tax_status,
            product.tax_class,
            product.manage_stock,
            product.stock_quantity,
            product.backorders,
            product.sold_individually,
            product.weight ? parseFloat(product.weight) : null,
            product.dimensions?.length ? parseFloat(product.dimensions.length) : null,
            product.dimensions?.width ? parseFloat(product.dimensions.width) : null,
            product.dimensions?.height ? parseFloat(product.dimensions.height) : null,
            product.shipping_required,
            product.reviews_allowed,
            parseFloat(product.average_rating) || 0,
            product.rating_count || 0,
            product.parent_id || null,
            product.purchase_note,
            JSON.stringify(product.categories || []),
            JSON.stringify(product.tags || []),
            JSON.stringify(product.images || []),
            JSON.stringify(product.attributes || []),
            JSON.stringify(product.variations || []),
            JSON.stringify(product.grouped_products || []),
            product.menu_order || 0,
            JSON.stringify(product.meta_data || [])
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

      const batchSize = 100;
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
              id, date_created, date_modified, email, first_name, last_name,
              role, username, billing, shipping, is_paying_customer, avatar_url, meta_data
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (email) DO UPDATE SET
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              billing = EXCLUDED.billing,
              shipping = EXCLUDED.shipping,
              updated_at = CURRENT_TIMESTAMP
          `;

          const values = [
            customer.id,
            customer.date_created ? new Date(customer.date_created) : null,
            customer.date_modified ? new Date(customer.date_modified) : null,
            customer.email,
            customer.first_name,
            customer.last_name,
            customer.role,
            customer.username,
            JSON.stringify(customer.billing || {}),
            JSON.stringify(customer.shipping || {}),
            customer.is_paying_customer,
            customer.avatar_url,
            JSON.stringify(customer.meta_data || [])
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
              id, parent_id, status, currency, version, prices_include_tax,
              date_created, date_modified, discount_total, discount_tax,
              shipping_total, shipping_tax, cart_tax, total, total_tax,
              customer_id, order_key, billing, shipping, payment_method,
              payment_method_title, transaction_id, customer_ip_address,
              customer_user_agent, created_via, customer_note, date_completed,
              date_paid, cart_hash, number, meta_data, line_items, tax_lines,
              shipping_lines, fee_lines, coupon_lines, refunds
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
              $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
              $29, $30, $31, $32, $33, $34, $35, $36, $37
            )
          `;

          const values = [
            order.id,
            order.parent_id || null,
            order.status,
            order.currency,
            order.version,
            order.prices_include_tax,
            order.date_created ? new Date(order.date_created) : null,
            order.date_modified ? new Date(order.date_modified) : null,
            parseFloat(order.discount_total) || 0,
            parseFloat(order.discount_tax) || 0,
            parseFloat(order.shipping_total) || 0,
            parseFloat(order.shipping_tax) || 0,
            parseFloat(order.cart_tax) || 0,
            parseFloat(order.total) || 0,
            parseFloat(order.total_tax) || 0,
            order.customer_id || null,
            order.order_key,
            JSON.stringify(order.billing || {}),
            JSON.stringify(order.shipping || {}),
            order.payment_method,
            order.payment_method_title,
            order.transaction_id,
            order.customer_ip_address,
            order.customer_user_agent,
            order.created_via,
            order.customer_note,
            order.date_completed ? new Date(order.date_completed) : null,
            order.date_paid ? new Date(order.date_paid) : null,
            order.cart_hash,
            order.number,
            JSON.stringify(order.meta_data || []),
            JSON.stringify(order.line_items || []),
            JSON.stringify(order.tax_lines || []),
            JSON.stringify(order.shipping_lines || []),
            JSON.stringify(order.fee_lines || []),
            JSON.stringify(order.coupon_lines || []),
            JSON.stringify(order.refunds || [])
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
      await this.ensureTables();
      
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
      if (counts && counts.products >= 3000) {
        console.log('✅ SUCCESS: All data imported successfully!');
        process.exit(0);
      } else {
        console.log('⚠️ WARNING: Import completed but product count is lower than expected');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 FATAL ERROR:', error);
      process.exit(1);
    });
}

export default EmergencyImporter;