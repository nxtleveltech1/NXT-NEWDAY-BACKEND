import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env.production') });

const runManualMigrations = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined in environment variables');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 20000,
  });

  client.on('error', err => {
    console.error('[Postgres Client Error]', err.stack);
  });

  try {
    await client.connect();
    const db = drizzle(client);
    
    console.log('🚀 Starting manual database migrations...');
    
    await migrate(db, {
      migrationsFolder: path.join(__dirname, 'src/db/migrations')
    });
    
    console.log('✅ Manual migrations completed successfully!');
    
  } catch (error) {
    console.error('❌ Manual migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
};

runManualMigrations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });