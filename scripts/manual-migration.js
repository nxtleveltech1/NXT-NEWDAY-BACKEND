import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';
import { testConnection, closePool } from '../src/config/database.js';

async function main() {
  try {
    console.log('Starting manual migration...');
    await testConnection();

    await db.execute(sql`ALTER TABLE products ADD COLUMN external_id INTEGER;`);
    await db.execute(sql`CREATE UNIQUE INDEX product_external_id_idx ON products (external_id);`);

    console.log('Manual migration completed successfully.');
  } catch (error) {
    console.error('Failed to run manual migration:', error);
  } finally {
    await closePool();
  }
}

main();