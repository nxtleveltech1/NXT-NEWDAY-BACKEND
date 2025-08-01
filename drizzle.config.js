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
  
  // Database connection configuration - NILEDB ONLY
  dbCredentials: {
    url: 'postgres://01985dad-5492-710e-a575-76c9bc6f3c98:216d1021-70e6-420a-b7c7-c9b8ff3646fc@eu-central-1.db.thenile.dev/NILEDB',
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