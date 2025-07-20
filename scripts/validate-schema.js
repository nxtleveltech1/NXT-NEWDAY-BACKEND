import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const EXPECTED_TABLES = [
  // Core tables
  'users',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  
  // Customer module
  'customers',
  'customer_segments',
  'customer_purchase_history',
  
  // Supplier module
  'suppliers',
  'supplier_contacts',
  'supplier_categories',
  'supplier_performance_metrics',
  
  // Product and pricing
  'products',
  'price_lists',
  'price_list_items',
  'price_approvals',
  
  // Orders and invoicing
  'purchase_orders',
  'purchase_order_items',
  'supplier_purchase_orders',
  'supplier_purchase_order_items',
  'invoices',
  'invoice_items',
  
  // Inventory
  'inventory',
  'inventory_movements',
  'stock_levels',
  
  // System tables
  'upload_history',
  'audit_logs',
  'notifications',
  'system_settings'
];

const EXPECTED_INDEXES = [
  // Performance indexes
  'idx_customers_email',
  'idx_customers_phone',
  'idx_suppliers_code',
  'idx_purchase_orders_customer_id',
  'idx_purchase_orders_status',
  'idx_invoices_customer_id',
  'idx_invoices_status',
  'idx_inventory_product_id',
  'idx_price_list_items_product_id'
];

const validateSchema = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined in environment variables');
  }

  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    onnotice: () => {}, // Suppress notices
  });

  try {
    console.log('🔍 Validating database schema...\n');

    // Check tables
    const tables = await sql`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `;

    const existingTables = tables.map(t => t.tablename);
    
    console.log('📊 Table Validation:');
    console.log('==================');
    
    let missingTables = [];
    let presentTables = [];

    for (const table of EXPECTED_TABLES) {
      if (existingTables.includes(table)) {
        presentTables.push(table);
        console.log(`✅ ${table}`);
      } else {
        missingTables.push(table);
        console.log(`❌ ${table} - MISSING`);
      }
    }

    // Check for unexpected tables
    const unexpectedTables = existingTables.filter(t => 
      !EXPECTED_TABLES.includes(t) && 
      !t.startsWith('drizzle_') && 
      !t.startsWith('pg_')
    );

    if (unexpectedTables.length > 0) {
      console.log('\n⚠️  Unexpected tables found:');
      unexpectedTables.forEach(t => console.log(`   - ${t}`));
    }

    // Check indexes
    console.log('\n📈 Index Validation:');
    console.log('===================');

    const indexes = await sql`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND indexname LIKE 'idx_%'
      ORDER BY indexname;
    `;

    const existingIndexes = indexes.map(i => i.indexname);
    let missingIndexes = [];

    for (const index of EXPECTED_INDEXES) {
      if (existingIndexes.includes(index)) {
        console.log(`✅ ${index}`);
      } else {
        missingIndexes.push(index);
        console.log(`❌ ${index} - MISSING`);
      }
    }

    // Check foreign key constraints
    console.log('\n🔗 Foreign Key Constraints:');
    console.log('==========================');

    const constraints = await sql`
      SELECT 
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name;
    `;

    if (constraints.length > 0) {
      console.log(`✅ Found ${constraints.length} foreign key constraints`);
      constraints.slice(0, 10).forEach(c => {
        console.log(`   - ${c.table_name}.${c.column_name} → ${c.foreign_table_name}.${c.foreign_column_name}`);
      });
      if (constraints.length > 10) {
        console.log(`   ... and ${constraints.length - 10} more`);
      }
    } else {
      console.log('⚠️  No foreign key constraints found');
    }

    // Summary
    console.log('\n📋 Summary:');
    console.log('===========');
    console.log(`Tables: ${presentTables.length}/${EXPECTED_TABLES.length} present`);
    console.log(`Indexes: ${existingIndexes.filter(i => EXPECTED_INDEXES.includes(i)).length}/${EXPECTED_INDEXES.length} present`);
    console.log(`Foreign Keys: ${constraints.length} found`);

    if (missingTables.length > 0) {
      console.log(`\n⚠️  Missing ${missingTables.length} tables!`);
      console.log('Run migrations with: npm run db:migrate');
      return false;
    }

    if (missingIndexes.length > 0) {
      console.log(`\n⚠️  Missing ${missingIndexes.length} performance indexes`);
    }

    console.log('\n✅ Schema validation complete!');
    return true;

  } catch (error) {
    console.error('❌ Schema validation failed:', error);
    throw error;
  } finally {
    await sql.end();
  }
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateSchema()
    .then((valid) => process.exit(valid ? 0 : 1))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default validateSchema;