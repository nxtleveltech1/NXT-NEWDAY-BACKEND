#!/usr/bin/env node

/**
 * COMPREHENSIVE SYSTEM VERIFICATION SCRIPT
 * Counts all records in NILEDB and verifies system status
 */

import { testNileConnection, nileDb } from './src/config/niledb.config.js';
import { sql } from 'drizzle-orm';

async function countDatabaseRecords() {
  console.log('🔍 COMPREHENSIVE SYSTEM VERIFICATION');
  console.log('=====================================');
  
  try {
    // Test NILEDB connection
    const isConnected = await testNileConnection();
    
    if (!isConnected) {
      console.log('❌ NILEDB Connection: FAILED');
      return false;
    }
    
    console.log('✅ NILEDB Connection: ACTIVE');
    console.log('');
    
    // Define all tables to check
    const tables = [
      'customers',
      'orders', 
      'products',
      'suppliers',
      'inventory',
      'invoices',
      'purchase_orders',
      'supplier_purchase_orders',
      'warehouses',
      'supplier_receipts',
      'upload_history',
      'external_ids'
    ];
    
    let totalRecords = 0;
    let activeTableCount = 0;
    
    console.log('📊 DATABASE RECORD COUNTS:');
    console.log('---------------------------');
    
    for (const table of tables) {
      try {
        const result = await nileDb.execute(sql.raw(`SELECT COUNT(*) as count FROM ${table}`));
        const count = parseInt(result[0]?.count || 0);
        
        if (count > 0) {
          console.log(`✅ ${table.padEnd(20)}: ${count.toLocaleString()} records`);
          totalRecords += count;
          activeTableCount++;
        } else {
          console.log(`⚪ ${table.padEnd(20)}: 0 records`);
        }
      } catch (err) {
        console.log(`❌ ${table.padEnd(20)}: Table not found or error`);
      }
    }
    
    console.log('');
    console.log('📈 SUMMARY:');
    console.log('============');
    console.log(`Total Records: ${totalRecords.toLocaleString()}`);
    console.log(`Active Tables: ${activeTableCount}/${tables.length}`);
    console.log(`Database Status: ${totalRecords > 1000 ? '✅ HEALTHY' : '⚠️ NEEDS DATA'}`);
    
    return {
      totalRecords,
      activeTableCount,
      tablesCount: tables.length,
      isHealthy: totalRecords > 1000
    };
    
  } catch (error) {
    console.error('❌ Database verification failed:', error.message);
    return false;
  }
}

// Run the verification
countDatabaseRecords().then(result => {
  if (result) {
    console.log('');
    console.log(result.isHealthy ? '🎉 DATABASE VERIFICATION: PASSED' : '⚠️ DATABASE VERIFICATION: NEEDS ATTENTION');
    process.exit(result.isHealthy ? 0 : 1);
  } else {
    console.log('');
    console.log('❌ DATABASE VERIFICATION: FAILED');
    process.exit(1);
  }
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});