import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';
import { testConnection, closePool } from '../src/config/database.js';

async function main() {
  try {
    console.log('Starting manual migration for warehouses address...');
    await testConnection();

    await db.execute(sql`ALTER TABLE warehouses ADD COLUMN address JSONB DEFAULT '{}';`);

    console.log('Manual migration for warehouses address completed successfully.');
  } catch (error) {
    console.error('Failed to run manual migration for warehouses address:', error);
  } finally {
    await closePool();
  }
}

main();