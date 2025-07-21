import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '../db/schema.js';

// Load environment variables
config();

// Validate required environment variables
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create Neon HTTP connection with optimized configuration
const sql = neon(process.env.DATABASE_URL, {
  // Connection pool settings for memory optimization
  arrayMode: false,
  fullResults: false,
  fetchOptions: {
    cache: 'no-store', // Prevent caching at HTTP level to save memory
  }
});

// Create Drizzle ORM instance with Neon HTTP adapter
export const db = drizzle(sql, {
  logger: process.env.NODE_ENV === 'development' && process.env.DB_LOGGING !== 'false',
  schema
});

// Database connection test function
export async function testConnection() {
  try {
    const result = await sql`SELECT 1 as test`;
    console.log('Database connection successful');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

// Export pool statistics (mock for HTTP connections)
export function getPoolStats() {
  return {
    totalConnections: 1,
    idleConnections: 0,
    activeConnections: 1,
    waitingRequests: 0,
    errors: 0,
    lastError: null,
    totalCount: 1,
    idleCount: 0,
    waitingCount: 0
  };
}

export default db;