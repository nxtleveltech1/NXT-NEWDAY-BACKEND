import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import runMigrations from './scripts/run-migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running production migrations...');

dotenv.config({ path: path.join(__dirname, '.env.production') });

runMigrations()
  .then(() => {
    console.log('Production migrations completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Production migrations failed:', error);
    process.exit(1);
  });