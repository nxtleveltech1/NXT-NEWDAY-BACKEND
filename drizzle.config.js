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
  
  // Database connection configuration - NILEDB PRODUCTION ONLY
  dbCredentials: {
    url: 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB',
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