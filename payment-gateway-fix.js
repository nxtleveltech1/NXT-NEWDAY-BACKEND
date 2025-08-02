#!/usr/bin/env node

// Complete fix for payment gateway service

import { readFileSync, writeFileSync } from 'fs';

const filePath = './src/services/payment-gateway.service.js';
let content = readFileSync(filePath, 'utf8');

// Replace the entire initializeDatabase method with a corrected version
const fixedMethod = `  async initializeDatabase() {
    try {
      // Payment transactions table
      const client = await pool.connect();
      try {
        await client.query(\`
        CREATE TABLE IF NOT EXISTS payment_transactions (
          id SERIAL PRIMARY KEY,
          transaction_id VARCHAR(255) UNIQUE NOT NULL,
          gateway VARCHAR(50) NOT NULL,
          gateway_transaction_id VARCHAR(255),
          amount DECIMAL(15,2) NOT NULL,
          currency VARCHAR(3) NOT NULL,
          status VARCHAR(50) NOT NULL,
          payment_method VARCHAR(50),
          customer_id INTEGER,
          order_id INTEGER,
          description TEXT,
          metadata JSONB DEFAULT '{}',
          gateway_response JSONB DEFAULT '{}',
          fees DECIMAL(15,2) DEFAULT 0,
          net_amount DECIMAL(15,2),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          processed_at TIMESTAMP WITH TIME ZONE
        )\`);

        // Payment methods table
        await client.query(\`
        CREATE TABLE IF NOT EXISTS customer_payment_methods (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER NOT NULL,
          gateway VARCHAR(50) NOT NULL,
          gateway_method_id VARCHAR(255),
          payment_type VARCHAR(50) NOT NULL,
          last_four VARCHAR(4),
          expiry_month INTEGER,
          expiry_year INTEGER,
          is_active BOOLEAN DEFAULT true,
          is_default BOOLEAN DEFAULT false,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )\`);

        // Payment refunds table
        await client.query(\`
        CREATE TABLE IF NOT EXISTS payment_refunds (
          id SERIAL PRIMARY KEY,
          refund_id VARCHAR(255) UNIQUE NOT NULL,
          transaction_id VARCHAR(255) NOT NULL,
          amount DECIMAL(15,2) NOT NULL,
          reason TEXT,
          status VARCHAR(50) NOT NULL,
          gateway_response JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          processed_at TIMESTAMP WITH TIME ZONE
        )\`);

        // Payment webhooks log
        await client.query(\`
        CREATE TABLE IF NOT EXISTS payment_webhooks (
          id SERIAL PRIMARY KEY,
          gateway VARCHAR(50) NOT NULL,
          event_type VARCHAR(100) NOT NULL,
          event_data JSONB NOT NULL,
          processed BOOLEAN DEFAULT false,
          response_status INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          processed_at TIMESTAMP WITH TIME ZONE
        )\`);

        console.log('✅ Payment database tables initialized');
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('❌ Failed to initialize payment database:', error);
      throw error;
    }
  }`;

// Find and replace the initializeDatabase method
const methodRegex = /async initializeDatabase\(\)\s*\{[\s\S]*?^\s*\}/m;
content = content.replace(methodRegex, fixedMethod);

writeFileSync(filePath, content);
console.log('✅ Payment gateway service completely fixed');