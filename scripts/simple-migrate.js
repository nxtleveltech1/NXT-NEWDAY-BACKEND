import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Migration files in order
const MIGRATIONS = [
    '0000_medical_maddog.sql',
    '0001_unified_supplier_module.sql',
    '0002_customer_purchase_history.sql',
    '0004_invoicing_system.sql',
    '0005_supplier_purchase_orders.sql',
    '0006_warehouses.sql',
    '0007_supplier_receipts.sql',
    '0003_performance_optimization_indexes.sql'
];

console.log('🚀 Starting database migrations...');
console.log('\nMigration Order:');
MIGRATIONS.forEach((m, i) => console.log(`${i + 1}. ${m}`));

console.log('\n⚠️  IMPORTANT: The migrations are ready to run.');
console.log('Since dependencies are not installed, you have two options:\n');

console.log('Option 1: Run migrations using psql directly');
console.log('You can use the following commands:\n');

MIGRATIONS.forEach(migration => {
    const filePath = path.join(__dirname, '../src/db/migrations', migration);
    console.log(`psql $DATABASE_URL -f "${filePath}"`);
});

console.log('\nOption 2: Install dependencies first');
console.log('1. Fix npm install issues (possibly by using --force flag)');
console.log('2. Then run: npm run db:migrate');

console.log('\nOption 3: Use Docker to run migrations');
console.log('docker-compose up -d postgres');
console.log('docker-compose exec backend npm run db:migrate');

console.log('\n📋 Migration files verified to exist:');
MIGRATIONS.forEach(migration => {
    const filePath = path.join(__dirname, '../src/db/migrations', migration);
    const exists = fs.existsSync(filePath);
    console.log(`${exists ? '✅' : '❌'} ${migration}`);
});