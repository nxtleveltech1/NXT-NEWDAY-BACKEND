import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';
import { testConnection, closePool } from '../src/config/database.js';

async function main() {
  try {
    console.log('Setting up default data...');
    await testConnection();

    // Create a default warehouse
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS warehouses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL
      );
    `);
    await db.execute(sql`
      INSERT INTO warehouses (name, code) VALUES ('Default Warehouse', 'DEFAULT') ON CONFLICT DO NOTHING;
    `);

    console.log('Default data setup completed successfully.');
  } catch (error) {
    console.error('Failed to setup default data:', error);
  } finally {
    await closePool();
  }
}

main();