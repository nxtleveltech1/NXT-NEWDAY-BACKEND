import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Drizzle configuration specifically for WooCommerce imported data
export default {
  // WooCommerce schema location
  schema: './src/db/woocommerce-schema.js',
  
  // Output directory for WooCommerce migrations
  out: './src/db/migrations/woocommerce',
  
  // Dialect for PostgreSQL
  dialect: 'postgresql',
  
  // Database connection configuration
  dbCredentials: {
    url: process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL,
  },
  
  // Additional options for better output
  verbose: true,
  strict: true,
  
  // Migration settings for WooCommerce tables
  migrations: {
    table: '__drizzle_woocommerce_migrations', // Separate migration table for WooCommerce
    schema: 'public'
  },
  
  // Custom configuration for WooCommerce import
  woocommerce: {
    enabled: process.env.POSTGRES_WOOCOMMERCE_IMPORTED === 'true',
    importDate: process.env.IMPORT_DATE,
    tables: {
      customers: 'customers',
      products: 'products', 
      orders: 'orders',
      importLog: 'import_log'
    }
  }
};