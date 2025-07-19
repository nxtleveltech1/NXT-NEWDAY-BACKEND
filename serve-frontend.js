import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static files from various directories
app.use('/static', express.static(path.join(__dirname, '../FRONTEND/src')));
app.use('/assets', express.static(path.join(__dirname, '../FRONTEND/src/assets')));
app.use(express.static(path.join(__dirname, '../FRONTEND/public')));

// API proxy to backend
app.use('/api', (req, res) => {
  // Proxy API calls to backend
  res.redirect(307, `http://localhost:4000${req.originalUrl}`);
});

// Serve the main HTML for all routes (SPA behavior)  
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../FRONTEND/public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🎨 Horizon UI Frontend Server running on http://localhost:${PORT}`);
  console.log(`📱 Main Dashboard: http://localhost:${PORT}/admin/default`);
  console.log(`🏢 Suppliers: http://localhost:${PORT}/admin/suppliers`);
  console.log(`📦 Inventory: http://localhost:${PORT}/admin/inventory`);
  console.log(`📊 Analytics: http://localhost:${PORT}/admin/analytics`);
});