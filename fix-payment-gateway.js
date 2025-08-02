#!/usr/bin/env node

// Quick fix for payment gateway service to use proper PostgreSQL connection

import { readFileSync, writeFileSync } from 'fs';

const filePath = './src/services/payment-gateway.service.js';
let content = readFileSync(filePath, 'utf8');

// Fix the database connection pattern
content = content.replace(
  /await client\.query\(`[^`]+`\);\n/g,
  (match) => {
    return match.replace(/;\n$/, ';\n      } finally {\n        client.release();\n      }\n');
  }
);

writeFileSync(filePath, content);
console.log('✅ Payment gateway service database connections fixed');