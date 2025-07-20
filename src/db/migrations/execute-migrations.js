import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables
config();

const { Pool } = pg;

// Migration configuration
const MIGRATION_SEQUENCE = [
  '0000_medical_maddog.sql',
  '0001_unified_supplier_module.sql',
  '0002_customer_purchase_history.sql',
  '0004_invoicing_system.sql',
  '0005_supplier_receipts.sql',
  '0006_supplier_purchase_orders.sql',
  '0007_warehouses.sql',
  '0003_performance_optimization_indexes.sql' // Run last, outside transaction
];

// Create migrations tracking table
const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64),
  success BOOLEAN DEFAULT true,
  error_message TEXT
);`;

class MigrationExecutor {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    this.db = drizzle(this.pool);
  }

  async initialize() {
    try {
      await this.pool.query(CREATE_MIGRATIONS_TABLE);
      console.log('✅ Migrations table ready');
    } catch (error) {
      console.error('❌ Failed to create migrations table:', error.message);
      throw error;
    }
  }

  async getExecutedMigrations() {
    try {
      const result = await this.pool.query(
        'SELECT name, executed_at, success FROM migrations ORDER BY executed_at'
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get migration status:', error.message);
      return [];
    }
  }

  async isMigrationExecuted(name) {
    try {
      const result = await this.pool.query(
        'SELECT success FROM migrations WHERE name = $1',
        [name]
      );
      return result.rows.length > 0 && result.rows[0].success;
    } catch (error) {
      return false;
    }
  }

  async executeMigration(migrationFile) {
    const migrationPath = join(__dirname, migrationFile);
    
    if (!existsSync(migrationPath)) {
      console.error(`❌ Migration file not found: ${migrationFile}`);
      return false;
    }

    console.log(`\n📋 Executing migration: ${migrationFile}`);
    
    const migrationContent = readFileSync(migrationPath, 'utf8');
    const checksum = this.calculateChecksum(migrationContent);
    
    // Check if already executed
    if (await this.isMigrationExecuted(migrationFile)) {
      console.log(`✅ Already executed: ${migrationFile}`);
      return true;
    }

    const client = await this.pool.connect();
    
    try {
      // Performance indexes should run outside transaction
      const useTransaction = !migrationFile.includes('performance_optimization');
      
      if (useTransaction) {
        await client.query('BEGIN');
      }

      // Execute migration
      await client.query(migrationContent);
      
      // Record migration
      await client.query(
        `INSERT INTO migrations (name, checksum, success) 
         VALUES ($1, $2, true)
         ON CONFLICT (name) 
         DO UPDATE SET executed_at = CURRENT_TIMESTAMP, checksum = $2, success = true`,
        [migrationFile, checksum]
      );

      if (useTransaction) {
        await client.query('COMMIT');
      }
      
      console.log(`✅ Successfully executed: ${migrationFile}`);
      return true;
    } catch (error) {
      if (!migrationFile.includes('performance_optimization')) {
        await client.query('ROLLBACK');
      }
      
      // Record failed migration
      await client.query(
        `INSERT INTO migrations (name, checksum, success, error_message) 
         VALUES ($1, $2, false, $3)
         ON CONFLICT (name) 
         DO UPDATE SET executed_at = CURRENT_TIMESTAMP, success = false, error_message = $3`,
        [migrationFile, checksum, error.message]
      );
      
      console.error(`❌ Failed to execute ${migrationFile}:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  calculateChecksum(content) {
    // Simple checksum for migration integrity
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async runAllMigrations() {
    console.log('🚀 Starting database migrations...\n');
    
    await this.initialize();
    
    const executedMigrations = await this.getExecutedMigrations();
    console.log(`📊 Currently executed migrations: ${executedMigrations.length}`);
    
    let successCount = 0;
    let failureCount = 0;
    
    for (const migration of MIGRATION_SEQUENCE) {
      try {
        const success = await this.executeMigration(migration);
        if (success) successCount++;
        else failureCount++;
      } catch (error) {
        failureCount++;
        
        // Stop on critical failures (except for performance indexes)
        if (!migration.includes('performance_optimization')) {
          console.error('\n❌ Critical migration failed. Stopping execution.');
          break;
        }
      }
    }
    
    console.log(`\n📊 Migration Summary:`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failureCount}`);
    console.log(`📁 Total: ${MIGRATION_SEQUENCE.length}`);
    
    return { successCount, failureCount };
  }

  async getMigrationStatus() {
    await this.initialize();
    
    const executed = await this.getExecutedMigrations();
    const executedNames = new Set(executed.map(m => m.name));
    
    console.log('\n📊 Migration Status Report\n');
    console.log('Planned migrations:');
    
    for (const migration of MIGRATION_SEQUENCE) {
      const isExecuted = executedNames.has(migration);
      const status = isExecuted ? '✅' : '⏳';
      const executedMigration = executed.find(m => m.name === migration);
      const timestamp = executedMigration ? 
        new Date(executedMigration.executed_at).toLocaleString() : 
        'Not executed';
      
      console.log(`${status} ${migration.padEnd(40)} ${timestamp}`);
    }
    
    console.log('\n📈 Summary:');
    console.log(`Executed: ${executed.filter(m => m.success).length}/${MIGRATION_SEQUENCE.length}`);
    console.log(`Failed: ${executed.filter(m => !m.success).length}`);
    
    return {
      total: MIGRATION_SEQUENCE.length,
      executed: executed.filter(m => m.success).length,
      failed: executed.filter(m => !m.success).length,
      pending: MIGRATION_SEQUENCE.length - executedNames.size
    };
  }

  async close() {
    await this.pool.end();
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] || 'run';
  const executor = new MigrationExecutor();
  
  try {
    switch (command) {
      case 'run':
        await executor.runAllMigrations();
        break;
      case 'status':
        await executor.getMigrationStatus();
        break;
      default:
        console.log('Usage: node execute-migrations.js [run|status]');
    }
  } catch (error) {
    console.error('Migration execution failed:', error);
    process.exit(1);
  } finally {
    await executor.close();
  }
}

export { MigrationExecutor };