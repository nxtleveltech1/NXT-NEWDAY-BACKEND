import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';
import { testConnection, closePool } from '../src/config/database.js';

async function main() {
  try {
    console.log('Starting manual migration for warehouses...');
    await testConnection();

    await db.execute(sql`
      CREATE TABLE warehouses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        address JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);
    await db.execute(sql`CREATE INDEX warehouse_code_idx ON warehouses (code);`);

    console.log('Manual migration for warehouses completed successfully.');
  } catch (error) {
    console.error('Failed to run manual migration for warehouses:', error);
  } finally {
    await closePool();
  }
}

main();