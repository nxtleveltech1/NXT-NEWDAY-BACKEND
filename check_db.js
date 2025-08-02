#!/usr/bin/env node

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB',
  ssl: { rejectUnauthorized: false }
});

async function checkDatabase() {
  try {
    console.log('🔍 Checking database structure...');
    
    // Check if tables exist
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('products', 'customers', 'orders')
      ORDER BY table_name
    `);
    
    console.log('📋 Existing tables:', tables.rows.map(r => r.table_name));
    
    for (const table of tables.rows) {
      console.log(`\n📊 ${table.table_name.toUpperCase()} structure:`);
      const columns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = $1 AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [table.table_name]);
      
      columns.rows.forEach(col => {
        console.log(`  ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
      });
      
      // Get row count
      const count = await pool.query(`SELECT COUNT(*) FROM ${table.table_name}`);
      console.log(`  📊 Current rows: ${count.rows[0].count}`);
    }
    
    // Check indexes
    console.log('\n🔗 Checking indexes...');
    const indexes = await pool.query(`
      SELECT indexname, tablename, indexdef 
      FROM pg_indexes 
      WHERE schemaname = 'public'
      AND tablename IN ('products', 'customers', 'orders')
      ORDER BY tablename, indexname
    `);
    
    indexes.rows.forEach(idx => {
      console.log(`  ${idx.tablename}.${idx.indexname}`);
    });
    
  } catch (error) {
    console.error('❌ Database check failed:', error.message);
  } finally {
    await pool.end();
  }
}

checkDatabase();