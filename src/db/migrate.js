import { migrate } from 'drizzle-orm/neon-http/migrator';
import { db } from './index.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function runMigrations() {
  console.log('Starting database migrations...');
  
  try {
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    console.log('Migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migrations
runMigrations();