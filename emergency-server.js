import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { testConnection } from "./src/config/database.js";

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

console.log('🚨 EMERGENCY SERVER - P1 BUSINESS CRITICAL MODE');
console.log('🎯 Simplified architecture for immediate API restoration');

// MINIMAL MIDDLEWARE ONLY - No authentication, monitoring, or complex services
app.use(cors({ 
  origin: ['http://localhost:5002', 'http://localhost:3000', 'http://localhost:3001'],
  credentials: true 
}));
app.use(express.json({ limit: '10mb' }));

// Basic error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// ESSENTIAL HEALTH CHECK
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'emergency_mode',
    message: 'Emergency simplified server operational',
    timestamp: new Date().toISOString(),
    mode: 'P1_BUSINESS_CRITICAL'
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    service: 'NXT Emergency Server',
    version: '1.0.0-emergency',
    status: 'operational',
    mode: 'emergency_simplified',
    modules: ['Core API Only'],
    timestamp: new Date().toISOString()
  });
});

// CORE API ROUTES - Import with error handling
try {
  const { default: supplierRoutes } = await import("./src/routes/supplier.routes.js");
  app.use("/api/suppliers", supplierRoutes);
  console.log('✅ Supplier routes loaded');
} catch (err) {
  console.error('❌ Failed to load supplier routes:', err.message);
}

try {
  const { default: customerRoutes } = await import("./src/routes/customer.routes.js");  
  app.use("/api/customers", customerRoutes);
  console.log('✅ Customer routes loaded');
} catch (err) {
  console.error('❌ Failed to load customer routes:', err.message);
}

// Basic inventory endpoint
app.get('/api/inventory', async (req, res) => {
  try {
    // Simple inventory response without complex services
    res.json({
      success: true,
      data: [
        { id: 1, sku: 'EMERGENCY-001', name: 'Emergency Mode Active', status: 'operational' }
      ],
      message: 'Emergency mode - simplified inventory response'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Basic analytics endpoint  
app.get('/api/analytics', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        mode: 'emergency',
        message: 'Analytics temporarily simplified for system stability'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found in emergency mode',
    availableEndpoints: ['/health', '/api/status', '/api/suppliers', '/api/customers', '/api/inventory', '/api/analytics']
  });
});

// START SERVER WITH MINIMAL SERVICES
async function startEmergencyServer() {
  try {
    console.log('🔍 Testing database connection...');
    const dbConnected = await testConnection();
    
    if (!dbConnected) {
      console.warn('⚠️  Database connection failed - starting server in offline mode');
    } else {
      console.log('✅ Database connection successful');
    }
    
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`\n🚀 EMERGENCY NXT BACKEND OPERATIONAL`);
      console.log(`🌐 Server: http://localhost:${port}`);
      console.log(`🩺 Health: http://localhost:${port}/health`);
      console.log(`📊 Status: http://localhost:${port}/api/status`);
      console.log(`⚡ Mode: P1 BUSINESS CRITICAL EMERGENCY`);
      console.log(`🎯 Simplified architecture for immediate restoration\n`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('📴 Emergency server shutting down...');
      server.close(() => {
        console.log('✅ Emergency server stopped');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('📴 Emergency server interrupted...');
      server.close(() => {
        console.log('✅ Emergency server stopped');
        process.exit(0);
      });
    });

  } catch (err) {
    console.error('💥 CRITICAL: Emergency server failed to start:', err);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
}

startEmergencyServer();