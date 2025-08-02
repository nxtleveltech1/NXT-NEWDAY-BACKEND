#!/usr/bin/env node

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

// Test WebSocket server functionality
const PORT = 4001;
const server = createServer();
const wss = new WebSocketServer({ server });

// Track connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('✅ New WebSocket client connected');
  clients.add(ws);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connection',
    message: 'Connected to NXT-ND WebSocket Server',
    timestamp: new Date().toISOString()
  }));
  
  // Handle messages
  ws.on('message', (data) => {
    console.log('📨 Received:', data.toString());
    
    // Broadcast to all clients
    const message = {
      type: 'broadcast',
      data: JSON.parse(data),
      timestamp: new Date().toISOString(),
      clients: clients.size
    };
    
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log('❌ Client disconnected');
    clients.delete(ws);
  });
  
  // Send real-time updates every 5 seconds
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'update',
        data: {
          orders: Math.floor(Math.random() * 100),
          revenue: Math.floor(Math.random() * 10000),
          customers: Math.floor(Math.random() * 50)
        },
        timestamp: new Date().toISOString()
      }));
    }
  }, 5000);
  
  ws.on('close', () => clearInterval(interval));
});

server.listen(PORT, () => {
  console.log(`🚀 WebSocket server running on ws://localhost:${PORT}`);
  console.log('📡 Broadcasting real-time updates every 5 seconds');
});

// Test client
const testClient = () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  
  ws.on('open', () => {
    console.log('🔗 Test client connected');
    
    // Send test messages
    ws.send(JSON.stringify({ action: 'test', data: 'Hello WebSocket!' }));
    
    setTimeout(() => {
      ws.send(JSON.stringify({ 
        action: 'order_update', 
        orderId: 'TEST-123',
        status: 'completed' 
      }));
    }, 2000);
  });
  
  ws.on('message', (data) => {
    console.log('📥 Client received:', JSON.parse(data.toString()));
  });
  
  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err);
  });
};

// Run test client after server starts
setTimeout(testClient, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down WebSocket server...');
  clients.forEach(client => client.close());
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});