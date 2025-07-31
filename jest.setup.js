// Load test environment variables
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

// Load .env.test if it exists, otherwise fall back to .env
const testEnvPath = join(process.cwd(), '.env.test');
const envPath = existsSync(testEnvPath) ? testEnvPath : '.env';

config({ path: envPath });

// Set NODE_ENV to test if not already set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

// Ensure critical environment variables are set for tests
if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL not set, using default test database URL');
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/nxt_test_db';
}

if (!process.env.STACK_PUBLISHABLE_CLIENT_KEY) {
  process.env.STACK_PUBLISHABLE_CLIENT_KEY = 'test_publishable_key';
}

if (!process.env.STACK_SECRET_SERVER_KEY) {
  process.env.STACK_SECRET_SERVER_KEY = 'test_secret_key';
}

// Suppress console logs during tests unless explicitly enabled
if (process.env.SUPPRESS_TEST_LOGS !== 'false') {
  global.console = {
    ...console,
    log: () => {},
    info: () => {},
    warn: () => {},
    // Keep error and debug for troubleshooting
    error: console.error,
    debug: console.debug,
  };
}

// Global test timeout
jest.setTimeout(30000);

// Clean up after tests
afterAll(async () => {
  // Close any open database connections
  const { pool } = await import('./src/config/database.js');
  if (pool) {
    await pool.end();
  }
});