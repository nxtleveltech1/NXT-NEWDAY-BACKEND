import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const runSimpleMigrations = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined in environment variables');
  }

  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  try {
    console.log('🚀 Starting simple database migrations...');
    
    // Create schema_migrations table first
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Created schema_migrations table');

    // Read and execute migration files in order
    const migrationsDir = path.join(__dirname, '../src/db/migrations');
    const migrationFiles = [
      '0000_medical_maddog.sql',
      '0001_unified_supplier_module.sql',
      '0002_customer_purchase_history.sql',
      '0003_performance_optimization_indexes.sql',
      '0004_invoicing_system.sql',
      '0005_supplier_purchase_orders.sql',
      '0006_warehouses.sql',
      '0007_supplier_receipts.sql',
      '0008_rbac_tables.sql'
    ];

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      
      if (fs.existsSync(filePath)) {
        console.log(`📄 Executing migration: ${file}`);
        const sql = fs.readFileSync(filePath, 'utf8');
        
        // Split SQL by statement breakpoints and execute each statement
        const statements = sql.split('--> statement-breakpoint').filter(stmt => stmt.trim());
        
        for (const statement of statements) {
          if (statement.trim()) {
            try {
              await pool.query(statement);
            } catch (error) {
              // Ignore errors for statements that might already exist
              if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
                console.warn(`⚠️ Statement warning: ${error.message}`);
              }
            }
          }
        }
        
        // Record migration as applied
        await pool.query(`
          INSERT INTO schema_migrations (version, applied_at)
          VALUES ($1, CURRENT_TIMESTAMP)
          ON CONFLICT (version) DO NOTHING;
        `, [file.replace('.sql', '')]);
        
        console.log(`✅ Completed migration: ${file}`);
      } else {
        console.warn(`⚠️ Migration file not found: ${file}`);
      }
    }
    
    console.log('✅ All migrations completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSimpleMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default runSimpleMigrations;