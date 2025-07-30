import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

// Database connection for migrations
const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(migrationClient);

/**
 * Run pending migrations
 */
export async function runMigrations() {
  try {
    console.log('🚀 Starting database migrations...');
    
    await migrate(db, {
      migrationsFolder: './src/db/migrations',
    });
    
    console.log('✅ Migrations completed successfully');
    
    // Close connection
    await migrationClient.end();
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await migrationClient.end();
    throw error;
  }
}

/**
 * Check migration status
 */
export async function checkMigrationStatus() {
  try {
    // Check if migrations table exists
    const result = await migrationClient`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '__drizzle_migrations'
      );
    `;
    
    if (!result[0]?.exists) {
      console.log('⚠️  No migration history found. Database needs initialization.');
      return { initialized: false, appliedMigrations: [] };
    }
    
    // Get applied migrations
    const appliedMigrations = await migrationClient`
      SELECT * FROM __drizzle_migrations ORDER BY id;
    `;
    
    console.log(`✅ Found ${appliedMigrations.length} applied migrations`);
    appliedMigrations.forEach(migration => {
      console.log(`  - ${migration.hash}: ${migration.created_at}`);
    });
    
    return { initialized: true, appliedMigrations };
    
  } catch (error) {
    console.error('❌ Failed to check migration status:', error);
    throw error;
  }
}

/**
 * Verify supplier schema is properly set up
 */
export async function verifySupplierSchema() {
  try {
    console.log('🔍 Verifying supplier schema...');
    
    // Check suppliers table structure
    const supplierColumns = await migrationClient`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'suppliers'
      ORDER BY ordinal_position;
    `;
    
    // Check price_lists table structure
    const priceListColumns = await migrationClient`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'price_lists'
      ORDER BY ordinal_position;
    `;
    
    // Check upload_history table structure
    const uploadHistoryColumns = await migrationClient`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'upload_history'
      ORDER BY ordinal_position;
    `;
    
    console.log(`✅ Suppliers table has ${supplierColumns.length} columns`);
    console.log(`✅ Price lists table has ${priceListColumns.length} columns`);
    console.log(`✅ Upload history table has ${uploadHistoryColumns.length} columns`);
    
    // Verify required supplier fields for vendor consolidation
    const requiredSupplierFields = [
      'supplier_code', 'company_name', 'email', 'phone', 'website',
      'address', 'supplier_type', 'vendor_metadata', 'is_approved'
    ];
    
    const existingFields = supplierColumns.map(col => col.column_name);
    const missingFields = requiredSupplierFields.filter(field => !existingFields.includes(field));
    
    if (missingFields.length > 0) {
      console.log(`⚠️  Missing supplier fields: ${missingFields.join(', ')}`);
      return { valid: false, missingFields };
    }
    
    // Verify price list version control fields
    const requiredPriceListFields = ['version', 'parent_price_list_id', 'validation_status'];
    const existingPriceListFields = priceListColumns.map(col => col.column_name);
    const missingPriceListFields = requiredPriceListFields.filter(field => !existingPriceListFields.includes(field));
    
    if (missingPriceListFields.length > 0) {
      console.log(`⚠️  Missing price list fields: ${missingPriceListFields.join(', ')}`);
      return { valid: false, missingPriceListFields };
    }
    
    console.log('✅ Supplier schema verification passed');
    return { valid: true };
    
  } catch (error) {
    console.error('❌ Schema verification failed:', error);
    throw error;
  }
}

/**
 * Create schema migration tracking table if needed
 */
export async function initializeMigrationTracking() {
  try {
    await migrationClient`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        description TEXT
      );
    `;
    
    console.log('✅ Migration tracking table initialized');
    
  } catch (error) {
    console.error('❌ Failed to initialize migration tracking:', error);
    throw error;
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  switch (command) {
    case 'migrate':
      await runMigrations();
      break;
      
    case 'status':
      await checkMigrationStatus();
      break;
      
    case 'verify':
      await verifySupplierSchema();
      break;
      
    case 'init':
      await initializeMigrationTracking();
      break;
      
    default:
      console.log(`
Usage: node migration-helper.js <command>

Commands:
  migrate  - Run pending migrations
  status   - Check migration status
  verify   - Verify supplier schema
  init     - Initialize migration tracking
      `);
  }
  
  process.exit(0);
}