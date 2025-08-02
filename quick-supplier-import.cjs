const { Client } = require('pg');
require('dotenv').config();

const NILEDB_URL = process.env.NILEDB_URL || 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB?sslmode=require';

async function quickSupplierImport() {
  const client = new Client(NILEDB_URL);
  await client.connect();
  
  console.log('🚨 QUICK SUPPLIER IMPORT...');
  
  // Check current suppliers
  const check = await client.query('SELECT COUNT(*) FROM suppliers');
  console.log('Current suppliers:', check.rows[0].count);
  
  if (check.rows[0].count > 0) {
    console.log('✅ Suppliers already exist!');
    await client.end();
    return;
  }
  
  // Add 10 suppliers quickly
  const suppliers = [
    ['ABC Electronics Ltd', 'ABC-001', 'John Smith', 'john@abcelectronics.com', '+27-11-555-0101'],
    ['Global Tech Supplies', 'GTS-002', 'Sarah Johnson', 'sarah@globaltech.com', '+27-11-555-0102'],
    ['Premium Components Inc', 'PCI-003', 'Mike Davis', 'mike@premiumcomp.com', '+27-11-555-0103'],
    ['FastShip Distributors', 'FSD-004', 'Emma Wilson', 'emma@fastship.com', '+27-11-555-0104'],
    ['Quality Parts Co', 'QPC-005', 'David Brown', 'david@qualityparts.com', '+27-11-555-0105'],
    ['Tech Wholesale SA', 'TWS-006', 'Lisa Anderson', 'lisa@techwholesale.com', '+27-11-555-0106'],
    ['Mega Electronics', 'MEL-007', 'James Taylor', 'james@megaelec.com', '+27-11-555-0107'],
    ['Supply Chain Pro', 'SCP-008', 'Maria Garcia', 'maria@supplychain.com', '+27-11-555-0108'],
    ['Digital Parts Hub', 'DPH-009', 'Robert Miller', 'robert@digitalparts.com', '+27-11-555-0109'],
    ['Component Masters', 'CMS-010', 'Jennifer Lee', 'jennifer@compmasters.com', '+27-11-555-0110']
  ];
  
  for (const [name, code, contact, email, phone] of suppliers) {
    await client.query(`
      INSERT INTO suppliers (name, code, contact_person, email, phone, address, city, country, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [name, code, contact, email, phone, '123 Business Park', 'Johannesburg', 'South Africa', true]);
  }
  
  console.log('✅ Added 10 suppliers successfully!');
  
  await client.end();
}

quickSupplierImport().catch(console.error);