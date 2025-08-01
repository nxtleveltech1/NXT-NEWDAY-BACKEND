# WebSocket Real-Time Service Implementation

Production-ready WebSocket server with Socket.io and NILEDB integration for real-time inventory updates, live order tracking, and customer activity streaming.

## 🚀 Features

### Core Real-Time Capabilities
- **Real-time Inventory Updates** - Live inventory level changes with NILEDB integration
- **Live Order Tracking** - Order status updates and shipment tracking
- **Customer Activity Streaming** - Real-time customer behavior and activity
- **Dashboard Updates** - Live metrics and KPI updates
- **Push Notifications** - Critical alerts and notifications
- **Multi-Namespace Architecture** - Organized data streams by functionality

### Advanced Features
- **Automatic Reconnection** - Client-side reconnection with exponential backoff
- **Message Queuing** - Offline message storage and replay
- **Rate Limiting** - Protection against excessive requests
- **Authentication Integration** - JWT-based user authentication
- **Redis Scaling** - Horizontal scaling with Redis adapter
- **Health Monitoring** - Comprehensive health checks and metrics
- **Performance Monitoring** - Real-time performance metrics and alerting

## 🏗️ Architecture

### Service Components

```
┌─────────────────────────────────────────────────────────────┐
│                    WebSocket Server                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │  Socket.io      │  │  Express HTTP   │                  │
│  │  WebSocket      │  │  Health/Metrics │                  │
│  │  Service        │  │  API            │                  │
│  └─────────────────┘  └─────────────────┘                  │
├─────────────────────────────────────────────────────────────┤
│                    NILEDB Integration                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │  Real-time      │  │  Change         │                  │
│  │  Data Service   │  │  Detection      │                  │
│  └─────────────────┘  └─────────────────┘                  │
├─────────────────────────────────────────────────────────────┤
│                    External Systems                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │   NILEDB    │ │   Redis     │ │  Main DB    │           │
│  │ PostgreSQL  │ │ (Optional)  │ │   MySQL     │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### Namespace Architecture

```
WebSocket Server (ws://localhost:4001)
├── / (Main)           - Connection management, authentication
├── /inventory         - Real-time inventory updates
├── /orders           - Live order tracking
├── /dashboard        - Dashboard metrics and KPIs
├── /customer         - Customer activity streaming
└── /notifications    - Push notifications
```

## 🚀 Quick Start

### 1. Installation

```bash
# Install dependencies (already included in main package.json)
npm install socket.io @socket.io/redis-adapter redis jsonwebtoken

# Make startup script executable
chmod +x start-websocket-server.js
```

### 2. Environment Configuration

Create or update your `.env` file:

```bash
# WebSocket Server Configuration
WEBSOCKET_PORT=4001
CORS_ORIGIN=http://localhost:3000,http://localhost:3001
WEBSOCKET_CLUSTER=false
WEBSOCKET_WORKERS=4
MAX_MEMORY_MB=1024
ENABLE_GC=true

# NILEDB Configuration (required)
NILEDB_CONNECTION_STRING=postgres://user:pass@host:port/database
# OR individual settings
NILEDB_HOST=eu-central-1.db.thenile.dev
NILEDB_USER=your-user-id
NILEDB_PASSWORD=your-password
NILEDB_DATABASE=NILEDB

# Redis Configuration (optional, for scaling)
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-jwt-secret

# Main Database (for fallback queries)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-password
DB_NAME=horizon
```

### 3. Start the Server

```bash
# Production start
npm run websocket:start

# Development start (with auto-reload)
npm run websocket:dev

# Test connection
npm run websocket:test
```

### 4. Verify Installation

```bash
# Check health
npm run websocket:health

# View metrics
npm run websocket:metrics

# View connected clients
npm run websocket:clients

# Test NILEDB connection
npm run niledb:test
```

## 📡 API Endpoints

### HTTP Health & Metrics API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server information and status |
| `/health` | GET | Comprehensive health check |
| `/metrics` | GET | Performance metrics |
| `/clients` | GET | Connected clients list |
| `/alerts` | GET | Active alerts from NILEDB |
| `/alerts/:id/acknowledge` | POST | Acknowledge an alert |
| `/changes/:dataType` | GET | Recent changes by type |
| `/test` | GET | WebSocket test page (dev only) |

### WebSocket Namespaces

#### Main Namespace (`/`)
```javascript
// Connection events
socket.on('connection:established', (data) => {
    console.log('Connected:', data);
});

// Authentication
socket.emit('auth:login', { token: 'jwt-token' });
socket.on('auth:success', (data) => {
    console.log('Authenticated');
});

// Data requests
socket.emit('data:request', {
    dataType: 'inventory_summary',
    parameters: { limit: 100 }
});
socket.on('data:response', (data) => {
    console.log('Data:', data);
});
```

#### Inventory Namespace (`/inventory`)
```javascript
const inventorySocket = io('/inventory');

// Subscribe to inventory updates
inventorySocket.emit('inventory:subscribe', {
    productIds: ['product-123', 'product-456'],
    warehouseIds: ['warehouse-1'],
    categories: ['electronics'],
    lowStockOnly: true
});

// Listen for updates
inventorySocket.on('inventory:update', (data) => {
    console.log('Inventory update:', data);
});

inventorySocket.on('inventory:low-stock', (alert) => {
    console.log('Low stock alert:', alert);
});

// Get current inventory data
inventorySocket.emit('inventory:get-current', {
    filters: { category: 'electronics' }
});
```

#### Orders Namespace (`/orders`)
```javascript
const ordersSocket = io('/orders');

// Subscribe to order updates
ordersSocket.emit('orders:subscribe', {
    orderIds: ['order-123'],
    customerId: 'customer-456',
    status: 'shipped',
    trackingEnabled: true
});

// Listen for updates
ordersSocket.on('order:update', (data) => {
    console.log('Order update:', data);
});

ordersSocket.on('order:tracking', (data) => {
    console.log('Tracking update:', data);
});

// Track specific order
ordersSocket.emit('orders:track', { orderId: 'order-123' });
```

#### Dashboard Namespace (`/dashboard`)
```javascript
const dashboardSocket = io('/dashboard');

// Subscribe to dashboard updates
dashboardSocket.emit('dashboard:subscribe', {
    dashboardId: 'main-dashboard',
    widgets: ['inventory-summary', 'order-stats', 'customer-activity'],
    metricsInterval: 5000 // Update every 5 seconds
});

// Listen for updates
dashboardSocket.on('dashboard:data', (data) => {
    console.log('Dashboard data:', data);
});

dashboardSocket.on('dashboard:metrics:live', (metrics) => {
    console.log('Live metrics:', metrics);
});
```

#### Customer Namespace (`/customer`)
```javascript
const customerSocket = io('/customer');

// Subscribe to customer activity
customerSocket.emit('customer:subscribe', {
    customerId: 'customer-123',
    activityTypes: ['login', 'purchase', 'browse'],
    realtimeTracking: true
});

// Listen for activity
customerSocket.on('customer:activity', (activity) => {
    console.log('Customer activity:', activity);
});
```

#### Notifications Namespace (`/notifications`)
```javascript
const notificationsSocket = io('/notifications');

// Subscribe to notifications
notificationsSocket.emit('notifications:subscribe', {
    types: ['low_stock', 'order_update', 'system_alert'],
    priority: 'high'
});

// Listen for notifications
notificationsSocket.on('notification', (notification) => {
    console.log('Notification:', notification);
    
    if (notification.priority === 'critical') {
        alert(notification.message);
    }
});
```

## 🔧 Configuration

### Server Configuration

```javascript
const config = {
    port: 4001,
    cors: {
        origin: ["http://localhost:3000"],
        methods: ["GET", "POST"],
        credentials: true
    },
    enableMetrics: true,
    enableHealthCheck: true,
    cluster: false,
    maxConnections: 1000,
    
    // Rate limiting
    rateLimit: {
        windowMs: 60000,      // 1 minute
        maxMessages: 100,     // Max messages per window
    },
    
    // Message queuing
    messageQueue: {
        maxQueueSize: 1000,
        messageRetention: 300000, // 5 minutes
    },
    
    // Reconnection settings
    reconnection: {
        maxAttempts: 5,
        delay: 1000,
        backoff: 'exponential'
    }
};
```

### NILEDB Integration

```javascript
// Alert thresholds (configurable)
const alertThresholds = {
    low_stock: { threshold: 10, severity: 'high' },
    out_of_stock: { threshold: 0, severity: 'critical' },
    high_order_volume: { threshold: 100, severity: 'medium' },
    slow_query: { threshold: 1000, severity: 'medium' }
};

// Polling intervals (configurable)
const pollingIntervals = {
    inventory: 5000,      // 5 seconds
    orders: 10000,        // 10 seconds
    customer_activity: 15000, // 15 seconds
    system_performance: 30000 // 30 seconds
};
```

## 🚀 Client Integration

### Using the WebSocket Client Utility

```javascript
import { WebSocketRealTimeClient, WebSocketUtils } from './utils/websocket-client.js';

// Create client
const client = new WebSocketRealTimeClient({
    url: 'http://localhost:4001',
    token: 'your-jwt-token',
    autoReconnect: true,
    maxReconnectAttempts: 5
});

// Connect to all namespaces
await client.connect();

// Subscribe to inventory updates
await client.subscribeToInventory({
    productIds: ['product-123'],
    lowStockOnly: true
});

// Listen for events
client.on('inventory:update', (data) => {
    updateInventoryDisplay(data);
});

client.on('inventory:low-stock', (alert) => {
    showLowStockAlert(alert);
});

// Request real-time data
const inventoryData = await client.requestData('inventory_summary', {
    limit: 100,
    category: 'electronics'
});

// Track order
const trackingInfo = await client.trackOrder('order-123');
```

### React Integration Example

```jsx
import React, { useEffect, useState } from 'react';
import { WebSocketRealTimeClient } from '../utils/websocket-client';

function InventoryDashboard() {
    const [client, setClient] = useState(null);
    const [inventory, setInventory] = useState([]);
    const [lowStockAlerts, setLowStockAlerts] = useState([]);

    useEffect(() => {
        const wsClient = new WebSocketRealTimeClient({
            url: process.env.REACT_APP_WEBSOCKET_URL,
            token: localStorage.getItem('authToken')
        });

        wsClient.connect().then(async () => {
            // Subscribe to inventory updates
            await wsClient.subscribeToInventory({
                lowStockOnly: false
            });

            // Listen for updates
            wsClient.on('inventory:update', (data) => {
                setInventory(prev => updateInventoryItem(prev, data));
            });

            wsClient.on('inventory:low-stock', (alert) => {
                setLowStockAlerts(prev => [...prev, alert]);
            });

            setClient(wsClient);
        });

        return () => {
            if (wsClient) {
                wsClient.disconnect();
            }
        };
    }, []);

    const updateInventoryItem = (inventory, update) => {
        // Update logic here
        return inventory.map(item => 
            item.productId === update.data.productId 
                ? { ...item, quantity: update.data.quantity }
                : item
        );
    };

    return (
        <div>
            <h2>Real-Time Inventory</h2>
            {/* Render inventory data */}
            {lowStockAlerts.length > 0 && (
                <div className="alerts">
                    {lowStockAlerts.map(alert => (
                        <div key={alert.id} className="alert alert-warning">
                            {alert.message}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
```

## 📊 Monitoring & Metrics

### Key Metrics

The server automatically tracks and exposes these metrics:

- **Connection Metrics**: Total connections, active connections, reconnections
- **Message Metrics**: Messages sent/received, error rates
- **Performance Metrics**: Average response time, memory usage, CPU usage
- **NILEDB Metrics**: Query count, error rate, connection health
- **Alert Metrics**: Alerts triggered, alert types, acknowledgment rates

### Health Monitoring

```bash
# Check overall health
curl http://localhost:4001/health

# Response structure
{
  "status": "healthy",
  "timestamp": "2025-08-01T06:30:00.000Z",
  "uptime": 3600000,
  "services": {
    "websocket": {
      "status": "healthy",
      "connections": 25,
      "metrics": { ... }
    },
    "niledb": {
      "status": "healthy",
      "queriesExecuted": 1250,
      "errorsOccurred": 0
    },
    "nileConnection": {
      "status": "healthy",
      "lastCheck": "2025-08-01T06:30:00.000Z"
    }
  }
}
```

### Performance Monitoring

```bash
# View detailed metrics
curl http://localhost:4001/metrics | jq

# Key performance indicators
{
  "server": {
    "uptime": 3600000,
    "totalRequests": 450,
    "errors": 2
  },
  "websocket": {
    "activeConnections": 25,
    "messagesSent": 1250,
    "messagesReceived": 850,
    "averageResponseTime": 15.5
  },
  "niledb": {
    "queriesExecuted": 125,
    "averageQueryTime": 45.2,
    "connectionHealth": "healthy"
  }
}
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Connection Failures
```bash
# Check server status
npm run websocket:health

# Check NILEDB connection
npm run niledb:test

# View server logs
npm run websocket:dev
```

#### 2. High Memory Usage
```bash
# Monitor memory usage
node --expose-gc start-websocket-server.js

# Check metrics
curl http://localhost:4001/metrics | jq '.server.memory'
```

#### 3. Slow Performance
```bash
# Check active connections
curl http://localhost:4001/clients

# Monitor query performance
curl http://localhost:4001/metrics | jq '.niledb.averageQueryTime'
```

### Debug Mode

```bash
# Enable debug logging
DEBUG=socket.io* npm run websocket:dev

# Enable Node.js debugging
node --inspect start-websocket-server.js
```

## 🧪 Testing

### Unit Tests

```bash
# Run WebSocket service tests
npm test -- --testPathPattern=websocket

# Run NILEDB integration tests
npm test -- --testPathPattern=niledb
```

### Integration Testing

```bash
# Test client connection
node -e "
import { WebSocketRealTimeClient } from './src/utils/websocket-client.js';
const client = new WebSocketRealTimeClient({ url: 'http://localhost:4001' });
client.connect().then(() => console.log('Connection successful'));
"

# Load testing
npx artillery quick --count 100 --num 10 ws://localhost:4001
```

### Manual Testing

1. Start the server: `npm run websocket:dev`
2. Open test page: http://localhost:4001/test
3. Test various WebSocket operations through the web interface

## 🚀 Production Deployment

### Environment Variables

```bash
# Production environment
NODE_ENV=production
WEBSOCKET_PORT=4001
CORS_ORIGIN=https://yourdomain.com
WEBSOCKET_CLUSTER=true
WEBSOCKET_WORKERS=8
MAX_MEMORY_MB=2048
ENABLE_GC=true

# Database connections
NILEDB_CONNECTION_STRING=postgres://user:pass@host:port/database
REDIS_URL=redis://redis-server:6379
DB_HOST=mysql-server
DB_USER=production_user
DB_PASSWORD=secure_password

# Security
JWT_SECRET=your-production-jwt-secret
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 4001

CMD ["npm", "run", "websocket:start"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  websocket-server:
    build: .
    ports:
      - "4001:4001"
    environment:
      - NODE_ENV=production
      - WEBSOCKET_PORT=4001
      - NILEDB_CONNECTION_STRING=${NILEDB_CONNECTION_STRING}
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    restart: unless-stopped
```

### Load Balancing

For high-availability deployments:

```nginx
upstream websocket_backend {
    ip_hash;  # Sticky sessions for WebSocket
    server server1:4001;
    server server2:4001;
    server server3:4001;
}

server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 📚 Additional Resources

### Documentation
- [Socket.io Documentation](https://socket.io/docs/)
- [NILEDB Documentation](https://docs.thenile.dev/)
- [Redis Adapter](https://socket.io/docs/v4/redis-adapter/)

### Performance Optimization
- Use Redis adapter for horizontal scaling
- Implement connection pooling
- Monitor memory usage and enable garbage collection
- Use namespace-based room organization

### Security Best Practices
- Always validate JWT tokens
- Implement rate limiting
- Use CORS restrictions
- Monitor for suspicious activity
- Log all security events

---

## 🎉 Success!

You now have a production-ready WebSocket real-time service with:

✅ **Socket.io server** with NILEDB integration  
✅ **Real-time inventory updates** from NILEDB  
✅ **Live order tracking** with NILEDB  
✅ **Customer activity streaming**  
✅ **Reconnection handling** with exponential backoff  
✅ **Comprehensive monitoring** and health checks  
✅ **Production-ready deployment** configuration  

The service is ready to handle real-time updates for your inventory management system with enterprise-grade reliability and performance.

For support or questions, refer to the troubleshooting section or check the server logs for detailed error information.