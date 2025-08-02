const fs = require('fs');

// Read the current index.js
const indexPath = '/home/gambew_admin/projects/nxtnewday/NXT-ND/BACKEND/index.js';
let content = fs.readFileSync(indexPath, 'utf8');

// Find where routes are defined
const routeInsertPoint = content.indexOf('routes.set(\'GET /api/fast-query\'');

// Add supplier routes
const supplierRoutes = `
// Supplier endpoints
routes.set('GET /api/suppliers', async () => {
  try {
    if (!dbPool) {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Database not available' })
      };
    }
    
    const [rows] = await dbPool.execute('SELECT * FROM suppliers WHERE is_active = true ORDER BY name');
    
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: true,
        data: rows,
        count: rows.length 
      })
    };
  } catch (error) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Query failed', message: error.message })
    };
  }
});

`;

// Insert the new routes
content = content.slice(0, routeInsertPoint) + supplierRoutes + content.slice(routeInsertPoint);

// Write back
fs.writeFileSync(indexPath, content);
console.log('✅ Added /api/suppliers endpoint to Fighter Jet server!');