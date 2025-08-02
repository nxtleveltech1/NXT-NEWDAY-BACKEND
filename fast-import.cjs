const { Client } = require('pg');
const fs = require('fs');

const NILEDB_URL = 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB?sslmode=require';

async function fastImport() {
  const client = new Client(NILEDB_URL);
  
  try {
    await client.connect();
    console.log('✅ Connected to NILEDB');
    
    // Don't clear - just add new products
    console.log('📊 Adding new products...');
    
    // Import Products
    console.log('\n📦 Importing Products...');
    const productsData = JSON.parse(fs.readFileSync('/home/gambew_admin/projects/uploads/woocommerce-products-2025-07-13.json', 'utf8'));
    
    let productCount = 0;
    const batchSize = 100;
    
    for (let i = 0; i < productsData.length; i += batchSize) {
      const batch = productsData.slice(i, i + batchSize);
      const values = [];
      const params = [];
      
      batch.forEach((product, idx) => {
        const baseIdx = idx * 7;
        values.push(`($${baseIdx+1}, $${baseIdx+2}, $${baseIdx+3}, $${baseIdx+4}, $${baseIdx+5}, $${baseIdx+6}, $${baseIdx+7})`);
        params.push(
          product.sku || `PROD-${product.id}`,
          product.name || product.title || 'Unknown Product',
          parseFloat(product.price) || 0,
          parseFloat(product.cost || product.price) * 0.6 || 0,
          parseInt(product.stock_quantity) || 0,
          product.stock_status || 'instock',
          parseFloat(product.price) || 0
        );
      });
      
      const query = `
        INSERT INTO products (sku, name, price, unit_cost, stock_quantity, stock_status, selling_price)
        VALUES ${values.join(', ')}
        ON CONFLICT (sku) DO NOTHING`;
      
      await client.query(query, params);
      productCount += batch.length;
      console.log(`  Imported ${productCount}/${productsData.length} products...`);
    }
    
    // Get final count
    const result = await client.query('SELECT COUNT(*) FROM products');
    console.log(`\n✅ COMPLETE: ${result.rows[0].count} products in database`);
    
  } catch (error) {
    console.error('❌ Import failed:', error.message);
  } finally {
    await client.end();
  }
}

fastImport();