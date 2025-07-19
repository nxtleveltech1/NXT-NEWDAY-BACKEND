import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static files from the FRONTEND directory
app.use('/static/css', express.static(path.join(__dirname, '../FRONTEND/src/assets/css')));
app.use('/static/js', express.static(path.join(__dirname, '../FRONTEND/src')));
app.use('/static/media', express.static(path.join(__dirname, '../FRONTEND/src/assets')));
app.use(express.static(path.join(__dirname, '../FRONTEND/public')));

// API proxy to backend
app.use('/api', (req, res) => {
  res.redirect(307, `http://localhost:4000${req.originalUrl}`);
});

// Create a simple bundle for the Horizon UI app
app.get('/static/js/bundle.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  
  const bundle = `
// Import React and ReactDOM from CDN (already loaded in HTML)
const { createRoot } = ReactDOM;
const { BrowserRouter, Routes, Route, Navigate } = ReactRouterDOM;

// Import App component source
${fs.readFileSync(path.join(__dirname, '../FRONTEND/src/App.jsx'), 'utf8')
  .replace(/import.*from.*['"]/g, '// ')
  .replace(/export default/g, 'window.App =')}

// Import index.js logic
const root = createRoot(document.getElementById("root"));
root.render(React.createElement(BrowserRouter, null, React.createElement(window.App)));
`;
  
  res.send(bundle);
});

// Serve the main HTML with proper script tags
app.get('*', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, '../FRONTEND/public/index.html'), 'utf8')
    .replace('</body>', `
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/react-router-dom@6/dist/umd/react-router-dom.development.js"></script>
    <script src="/static/js/bundle.js"></script>
    </body>`);
  
  res.send(html);
});

app.listen(PORT, () => {
  console.log('🎨 Horizon UI Framework Server running on http://localhost:3000');
  console.log('📱 Full React Router + Components active');
  console.log('🔗 API Proxy: /api -> http://localhost:4000');
});