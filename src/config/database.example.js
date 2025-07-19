// Example of how to use the database configuration

import { db, testConnection } from './database.js';
import { sql } from 'drizzle-orm';

// Example 1: Test database connection
async function checkConnection() {
  const isConnected = await testConnection();
  if (isConnected) {
    console.log('Successfully connected to Neon database');
  } else {
    console.error('Failed to connect to database');
  }
}

// Example 2: Execute a simple query
async function exampleQuery() {
  try {
    // Raw SQL query
    const result = await db.execute(sql`SELECT NOW() as current_time`);
    console.log('Current database time:', result.rows[0].current_time);
  } catch (error) {
    console.error('Query error:', error);
  }
}

// Example 3: Using with Drizzle schema (once you have schemas defined)
async function exampleWithSchema() {
  // Import your schema here
  // import { users } from '../db/schema.js';
  
  // Example queries:
  // const allUsers = await db.select().from(users);
  // const newUser = await db.insert(users).values({ name: 'John', email: 'john@example.com' }).returning();
}

// Run examples
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Running database configuration examples...');
  await checkConnection();
  await exampleQuery();
}