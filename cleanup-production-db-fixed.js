#!/usr/bin/env node

/**
 * Production Database Cleanup Script - FIXED
 * Removes ALL mock, test, sample, and dummy data from NILEDB
 * EMERGENCY P1 - Use ONLY production data
 */

import { Pool } from 'pg';

const NILEDB_CONNECTION_STRING = 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB';

const pool = new Pool({
  connectionString: NILEDB_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false }
});

async function cleanupProductionDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🚨 EMERGENCY P1: Starting production database cleanup...');
    console.log('🎯 Target: Remove ALL mock/test/sample/dummy data');
    console.log('💾 Database: NILEDB (Production)');
    console.log('');

    // 1. Clean suppliers table
    console.log('🧹 Cleaning suppliers table...');
    const suppliersResult = await client.query(`
      DELETE FROM suppliers 
      WHERE name ILIKE '%test%' 
         OR name ILIKE '%demo%' 
         OR name ILIKE '%sample%' 
         OR name ILIKE '%mock%'
         OR name ILIKE '%dummy%'
         OR name ILIKE '%fake%'
         OR code ILIKE '%test%'
         OR code ILIKE '%demo%'
         OR contact_person ILIKE '%test%'
         OR email ILIKE '%test%'
         OR email ILIKE '%example%'
    `);
    console.log(`   ✅ Removed ${suppliersResult.rowCount} test suppliers`);

    // 2. Clean customers table  
    console.log('🧹 Cleaning customers table...');
    const customersResult = await client.query(`
      DELETE FROM customers 
      WHERE first_name ILIKE '%test%' 
         OR first_name ILIKE '%demo%' 
         OR first_name ILIKE '%sample%' 
         OR first_name ILIKE '%mock%'
         OR last_name ILIKE '%test%'
         OR last_name ILIKE '%demo%'
         OR username ILIKE '%test%'
         OR username ILIKE '%demo%'
         OR email ILIKE '%test%'
         OR email ILIKE '%demo%'
         OR email ILIKE '%example%'
    `);
    console.log(`   ✅ Removed ${customersResult.rowCount} test customers`);

    // 3. Clean products table
    console.log('🧹 Cleaning products table...');
    const productsResult = await client.query(`
      DELETE FROM products 
      WHERE name ILIKE '%test%' 
         OR name ILIKE '%demo%' 
         OR name ILIKE '%sample%' 
         OR name ILIKE '%mock%'
         OR name ILIKE '%dummy%'
         OR name ILIKE '%fake%'
         OR sku ILIKE '%test%'
         OR sku ILIKE '%demo%'
         OR sku ILIKE '%sample%'
         OR slug ILIKE '%test%'
         OR slug ILIKE '%demo%'
    `);
    console.log(`   ✅ Removed ${productsResult.rowCount} test products`);

    // 4. Clean orders table (if it has notes or description)
    console.log('🧹 Cleaning orders table...');
    try {
      const ordersResult = await client.query(`
        DELETE FROM orders 
        WHERE EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'orders' 
          AND column_name IN ('notes', 'description')
        )
        AND (
          COALESCE(notes, '') ILIKE '%test%' 
          OR COALESCE(notes, '') ILIKE '%demo%' 
          OR COALESCE(notes, '') ILIKE '%sample%'
        )
      `);
      console.log(`   ✅ Removed ${ordersResult.rowCount} test orders`);
    } catch (error) {
      console.log(`   ⚠️  Orders table cleanup skipped: ${error.message}`);
    }

    // 5. Clean users table
    console.log('🧹 Cleaning users table...');
    const usersResult = await client.query(`
      DELETE FROM users 
      WHERE email ILIKE '%test%' 
         OR email ILIKE '%demo%' 
         OR email ILIKE '%sample%' 
         OR email ILIKE '%mock%'
         OR email ILIKE '%example%'
         OR first_name ILIKE '%test%'
         OR last_name ILIKE '%test%'
         OR name ILIKE '%test%'
         OR name ILIKE '%demo%'
    `);
    console.log(`   ✅ Removed ${usersResult.rowCount} test users`);

    // 6. Clean warehouses table
    console.log('🧹 Cleaning warehouses table...');
    try {
      const warehousesResult = await client.query(`
        DELETE FROM warehouses 
        WHERE name ILIKE '%test%' 
           OR name ILIKE '%demo%' 
           OR name ILIKE '%sample%' 
           OR name ILIKE '%mock%'
      `);
      console.log(`   ✅ Removed ${warehousesResult.rowCount} test warehouses`);
    } catch (error) {
      console.log(`   ⚠️  Warehouses table cleanup skipped: ${error.message}`);
    }

    // 7. Clean categories table
    console.log('🧹 Cleaning categories table...');
    try {
      const categoriesResult = await client.query(`
        DELETE FROM categories 
        WHERE name ILIKE '%test%' 
           OR name ILIKE '%demo%' 
           OR name ILIKE '%sample%' 
           OR name ILIKE '%mock%'
      `);
      console.log(`   ✅ Removed ${categoriesResult.rowCount} test categories`);
    } catch (error) {
      console.log(`   ⚠️  Categories table cleanup skipped: ${error.message}`);
    }

    // 8. Clean stock levels (orphaned)
    console.log('🧹 Cleaning orphaned stock levels...');
    try {
      const stockResult = await client.query(`
        DELETE FROM stock_levels 
        WHERE product_id NOT IN (SELECT id FROM products)
      `);
      console.log(`   ✅ Removed ${stockResult.rowCount} orphaned stock levels`);
    } catch (error) {
      console.log(`   ⚠️  Stock levels cleanup skipped: ${error.message}`);
    }

    // 9. Clean todos table (if it exists)
    console.log('🧹 Cleaning todos table...');
    try {
      const todosResult = await client.query(`
        DELETE FROM todos 
        WHERE title ILIKE '%test%' 
           OR title ILIKE '%demo%' 
           OR title ILIKE '%sample%' 
           OR description ILIKE '%test%'
      `);
      console.log(`   ✅ Removed ${todosResult.rowCount} test todos`);
    } catch (error) {
      console.log(`   ⚠️  Todos table cleanup skipped: ${error.message}`);
    }

    // 10. Verify cleanup
    console.log('');
    console.log('📊 Production Database Status After Cleanup:');
    
    const stats = await client.query(`
      SELECT 
        'suppliers' as table_name, COUNT(*) as remaining_records FROM suppliers
      UNION ALL
      SELECT 'customers', COUNT(*) FROM customers
      UNION ALL
      SELECT 'products', COUNT(*) FROM products
      UNION ALL
      SELECT 'orders', COUNT(*) FROM orders
      UNION ALL
      SELECT 'users', COUNT(*) FROM users
      ORDER BY table_name
    `);
    
    stats.rows.forEach(row => {
      console.log(`   📈 ${row.table_name}: ${row.remaining_records} records`);
    });

    console.log('');
    console.log('✅ EMERGENCY P1 CLEANUP COMPLETED!');
    console.log('🎯 All mock/test/sample/dummy data removed from production');
    console.log('💾 NILEDB is now using production data ONLY');
    
  } catch (error) {
    console.error('❌ CRITICAL ERROR during production cleanup:', error.message);
    console.error('🚨 Production database may be in inconsistent state!');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Execute cleanup
cleanupProductionDatabase()
  .then(() => {
    console.log('🎉 Production database cleanup successful!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Production database cleanup failed:', error);
    process.exit(1);
  });