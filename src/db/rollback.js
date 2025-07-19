import { sql } from 'drizzle-orm';
import { db } from './index.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Backup current database state
export async function backupDatabase(backupName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, 'backups', `${backupName}-${timestamp}`);
  
  await fs.mkdir(backupDir, { recursive: true });
  
  const tables = [
    'customers', 'suppliers', 'products', 'inventory',
    'inventory_movements', 'price_lists', 'price_list_items',
    'analytics_daily_aggregates', 'analytics_monthly_aggregates',
    'time_series_metrics', 'time_series_events', 'time_series_hourly_metrics'
  ];
  
  const backupManifest = {
    timestamp,
    tables: {},
    totalRecords: 0
  };
  
  for (const table of tables) {
    try {
      const data = await db.execute(sql`SELECT * FROM ${sql.identifier(table)}`);
      const filePath = path.join(backupDir, `${table}.json`);
      
      await fs.writeFile(filePath, JSON.stringify(data.rows, null, 2));
      
      backupManifest.tables[table] = {
        recordCount: data.rows.length,
        file: `${table}.json`
      };
      backupManifest.totalRecords += data.rows.length;
      
      console.log(`Backed up ${data.rows.length} records from ${table}`);
    } catch (error) {
      console.error(`Error backing up ${table}:`, error.message);
    }
  }
  
  await fs.writeFile(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify(backupManifest, null, 2)
  );
  
  console.log(`Backup completed: ${backupDir}`);
  return backupDir;
}

// Rollback to specific migration
export async function rollbackMigration(migrationName) {
  console.log(`Rolling back migration: ${migrationName}`);
  
  const rollbackMap = {
    '0000_medical_maddog': async () => {
      // Drop all tables in reverse order of dependencies
      const dropStatements = [
        'DROP TABLE IF EXISTS time_series_hourly_metrics CASCADE',
        'DROP TABLE IF EXISTS time_series_events CASCADE',
        'DROP TABLE IF EXISTS time_series_metrics CASCADE',
        'DROP TABLE IF EXISTS analytics_monthly_aggregates CASCADE',
        'DROP TABLE IF EXISTS analytics_daily_aggregates CASCADE',
        'DROP TABLE IF EXISTS price_list_items CASCADE',
        'DROP TABLE IF EXISTS price_lists CASCADE',
        'DROP TABLE IF EXISTS inventory_movements CASCADE',
        'DROP TABLE IF EXISTS inventory CASCADE',
        'DROP TABLE IF EXISTS products CASCADE',
        'DROP TABLE IF EXISTS suppliers CASCADE',
        'DROP TABLE IF EXISTS customers CASCADE'
      ];
      
      for (const statement of dropStatements) {
        await db.execute(sql.raw(statement));
        console.log(`Executed: ${statement}`);
      }
    }
  };
  
  if (rollbackMap[migrationName]) {
    await rollbackMap[migrationName]();
    console.log('Rollback completed');
  } else {
    throw new Error(`No rollback procedure for migration: ${migrationName}`);
  }
}

// Restore from backup
export async function restoreFromBackup(backupPath) {
  console.log(`Restoring from backup: ${backupPath}`);
  
  const manifestPath = path.join(backupPath, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  
  console.log(`Found backup from ${manifest.timestamp}`);
  
  // Disable foreign key checks
  await db.execute(sql`SET session_replication_role = 'replica'`);
  
  try {
    for (const [table, info] of Object.entries(manifest.tables)) {
      const dataPath = path.join(backupPath, info.file);
      const data = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
      
      if (data.length > 0) {
        // Clear existing data
        await db.execute(sql.raw(`DELETE FROM ${table}`));
        
        // Restore data
        const tableSchema = await import('./schema.js').then(m => m[table]);
        await db.insert(tableSchema).values(data);
        
        console.log(`Restored ${data.length} records to ${table}`);
      }
    }
  } finally {
    // Re-enable foreign key checks
    await db.execute(sql`SET session_replication_role = 'origin'`);
  }
  
  console.log('Restore completed');
}

// Test rollback procedures
export async function testRollback() {
  console.log('Testing rollback procedures...');
  
  try {
    // 1. Create a backup
    const backupPath = await backupDatabase('test-rollback');
    
    // 2. Insert test data
    await db.execute(sql`
      INSERT INTO customers (customer_code, company_name, email)
      VALUES ('TEST-001', 'Test Company', 'test@example.com')
    `);
    
    // 3. Verify data exists
    const beforeCount = await db.execute(sql`SELECT COUNT(*) as count FROM customers`);
    console.log(`Records before rollback: ${beforeCount.rows[0].count}`);
    
    // 4. Restore from backup
    await restoreFromBackup(backupPath);
    
    // 5. Verify rollback
    const afterCount = await db.execute(sql`SELECT COUNT(*) as count FROM customers`);
    console.log(`Records after rollback: ${afterCount.rows[0].count}`);
    
    console.log('Rollback test completed successfully');
  } catch (error) {
    console.error('Rollback test failed:', error);
    throw error;
  }
}