import { exec } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env.production') });

const command = `npx drizzle-kit migrate --config=./drizzle.config.js`;

const child = exec(command, { cwd: __dirname });

child.stdout.on('data', (data) => {
  console.log(data);
});

child.stderr.on('data', (data) => {
  console.error(data);
});

child.on('close', (code) => {
  console.log(`child process exited with code ${code}`);
});