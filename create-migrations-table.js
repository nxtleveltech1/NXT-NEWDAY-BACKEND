import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env.production') });

const createMigrationsTable = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined in environment variables');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    const db = drizzle(client);
    
    console.log('🚀 Creating schema_migrations table...');
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version varchar(255) PRIMARY KEY,
        applied_at timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    
    console.log('✅ schema_migrations table created successfully!');
    
  } catch (error) {
    console.error('❌ Failed to create schema_migrations table:', error);
    throw error;
  } finally {
    await client.end();
  }
};

createMigrationsTable()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });