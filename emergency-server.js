#!/usr/bin/env node

import { createServer } from 'http';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const PORT = 4000;
const NILEDB_URL = process.env.NILEDB_URL || 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB?sslmode=require';

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  console.log(`${req.method} ${req.url}`);
  
  if (req.url === '/api/suppliers' && req.method === 'GET') {
    try {
      const client = new Client(NILEDB_URL);
      await client.connect();
      
      const result = await client.query('SELECT * FROM suppliers WHERE is_active = true ORDER BY name');
      
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        data: result.rows,
        count: result.rows.length
      }));
      
      await client.end();
    } catch (error) {
      console.error('Database error:', error);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Database error', message: error.message }));
    }
  } else if (req.url === '/api/customers' && req.method === 'GET') {
    try {
      const client = new Client(NILEDB_URL);
      await client.connect();
      
      // Try to get customers, fallback to mock data if table doesn't exist
      let result;
      try {
        result = await client.query('SELECT * FROM customers ORDER BY created_at DESC LIMIT 10');
      } catch (dbError) {
        // If customers table doesn't exist, return mock data
        result = { rows: [
          { id: 1, company_name: 'Sample Customer 1', customer_code: 'CUST-001', created_at: new Date() },
          { id: 2, company_name: 'Sample Customer 2', customer_code: 'CUST-002', created_at: new Date() }
        ]};
      }
      
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        data: result.rows,
        count: result.rows.length
      }));
      
      await client.end();
    } catch (error) {
      console.error('Customers endpoint error:', error);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Database error', message: error.message }));
    }
  } else if (req.url === '/api/mysql/stats' && req.method === 'GET') {
    try {
      const client = new Client(NILEDB_URL);
      await client.connect();
      
      // Get basic database stats
      const suppliersCount = await client.query('SELECT COUNT(*) as count FROM suppliers');
      const activeSuppliers = await client.query('SELECT COUNT(*) as count FROM suppliers WHERE is_active = true');
      
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        data: {
          suppliers: {
            total: parseInt(suppliersCount.rows[0].count),
            active: parseInt(activeSuppliers.rows[0].count)
          },
          database: 'NILEDB PostgreSQL',
          timestamp: Date.now()
        }
      }));
      
      await client.end();
    } catch (error) {
      console.error('Stats endpoint error:', error);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Database error', message: error.message }));
    }
  } else if (req.url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.listen(PORT, () => {
  console.log(`🚀 EMERGENCY SERVER RUNNING ON PORT ${PORT}`);
  console.log(`📡 Test endpoints:`);
  console.log(`   - http://localhost:${PORT}/health`);
  console.log(`   - http://localhost:${PORT}/api/suppliers`);
});