import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 4001;

// Middleware
app.use(cors());
app.use(express.json());

// Basic health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    message: 'NXT NEW DAY Backend Server is running'
  });
});

// Basic API endpoints
app.get('/api/status', (req, res) => {
  res.json({
    service: 'NXT NEW DAY Backend',
    version: '1.0.0',
    status: 'operational',
    modules: ['Customer', 'Supplier', 'Inventory', 'Analytics'],
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 NXT NEW DAY Backend Server running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Status: http://localhost:${PORT}/api/status`);
});