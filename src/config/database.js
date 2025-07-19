import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as schema from '../db/schema.js';

// Load environment variables
config();

// Configure Neon for local development (if needed)
if (process.env.NODE_ENV !== 'production') {
  // Set WebSocket implementation for local development
  neonConfig.webSocketConstructor = ws;
}

// Validate required environment variables
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create connection pool with serverless-optimized settings
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Connection pool settings for serverless
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: 5000,
  // SSL is required for Neon
  ssl: {
    rejectUnauthorized: true
  }
});

// Create Drizzle ORM instance with Neon serverless adapter
export const db = drizzle(pool, {
  logger: process.env.NODE_ENV === 'development',
  schema
});

// Database connection test function
export async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT 1');
    client.release();
    console.log('Database connection successful');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

// Graceful shutdown handler
export async function closeDatabase() {
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch (error) {
    console.error('Error closing database pool:', error);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDatabase();
  process.exit(0);
});

export default db;