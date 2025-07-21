import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export default {
  // Schema location
  schema: './src/db/schema.js',
  
  // Output directory for generated migrations
  out: './src/db/migrations',
  
  // Dialect for PostgreSQL
  dialect: 'postgresql',
  
  // Database connection configuration
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  
  // Additional options for better output
  verbose: true,
  strict: true,
  
  // Migration settings
  migrations: {
    table: '__drizzle_migrations', // Table to track migrations
    schema: 'public'
  }
};