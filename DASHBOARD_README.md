# NXT New Day - Real-Time Business Dashboard

## 🚀 Overview

The NXT New Day Dashboard is a comprehensive, real-time business intelligence platform that provides instant insights into sales, inventory, customers, and system performance. Built with modern technologies and optimized for speed and reliability.

## ✨ Features

### 📊 **Real-Time Widgets**
- **Sales Analytics**: Live sales metrics, trends, and top products
- **Inventory Management**: Stock levels, low stock alerts, warehouse status
- **Customer Insights**: Active users, conversion rates, geographic distribution
- **System Performance**: CPU, memory, disk usage, and health monitoring
- **Activity Feed**: Real-time business activity stream
- **Alert System**: Critical notifications and system alerts

### 🌐 **Real-Time Data**
- **WebSocket Integration**: Live data updates every 5 seconds
- **NileDB Connection**: PostgreSQL database for persistent metrics
- **Server-Sent Events**: Streaming data for specific metrics
- **Auto-Reconnection**: Robust connection handling

### 🎨 **Modern UI/UX**
- **Dark Mode Support**: Toggle between light and dark themes
- **Mobile Responsive**: Optimized for all screen sizes
- **Interactive Charts**: Chart.js powered visualizations
- **Export Capabilities**: JSON, CSV export options
- **Print Support**: Dashboard printing functionality

### 🔒 **Enterprise Features**
- **Rate Limiting**: API protection and performance optimization
- **Error Handling**: Comprehensive error recovery
- **Caching**: Intelligent data caching for performance
- **Health Monitoring**: System health checks and diagnostics

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Dashboard                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│  │   Charts    │ │   Widgets   │ │     Real-time Data      │ │
│  │ (Chart.js)  │ │ (Bootstrap) │ │     (WebSockets)       │ │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Services                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│  │ Dashboard   │ │ WebSocket   │ │     API Routes          │ │
│  │ Service     │ │ Manager     │ │   (Express.js)          │ │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     Data Layer                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│  │   NileDB    │ │   Memory    │ │      Cache Layer        │ │
│  │(PostgreSQL) │ │   Cache     │ │                         │ │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL (via NileDB)
- Modern web browser

### Installation

1. **Install Dependencies**
```bash
npm install
```

2. **Configure NileDB Connection**
The dashboard uses the provided NileDB connection string:
```
postgres://01985dad-5492-710e-a575-76c9bc6f3c98:216d1021-70e6-420a-b7c7-c9b8ff3646fc@eu-central-1.db.thenile.dev/NILEDB
```

3. **Initialize Dashboard**
```bash
# Run the comprehensive test suite
node test-dashboard.js

# Or integrate with existing server
import { dashboardIntegration } from './src/integrations/dashboard-integration.js';
await dashboardIntegration.initialize(app, server);
```

4. **Access Dashboard**
```bash
# Start your server
npm start

# Open dashboard
http://localhost:4000/dashboard
```

## 📡 API Endpoints

### Core Endpoints
- `GET /api/dashboard/health` - System health check
- `GET /api/dashboard/overview` - Complete dashboard overview
- `GET /api/dashboard/sales` - Sales metrics and analytics
- `GET /api/dashboard/inventory` - Inventory status and alerts
- `GET /api/dashboard/customers` - Customer insights and metrics
- `GET /api/dashboard/performance` - System performance data
- `GET /api/dashboard/activity` - Recent activity feed
- `GET /api/dashboard/alerts` - System alerts and notifications

### Real-Time Endpoints
- `GET /api/dashboard/realtime/:dataType` - Server-Sent Events stream
- `WebSocket /dashboard-ws` - Real-time WebSocket connection

### Utility Endpoints
- `POST /api/dashboard/initialize` - Initialize dashboard system
- `POST /api/dashboard/notifications` - Send notifications
- `GET /api/dashboard/export/:format` - Export dashboard data
- `DELETE /api/dashboard/cache` - Clear dashboard cache

## 🔌 WebSocket Integration

The dashboard uses WebSockets for real-time updates:

```javascript
// Connect to dashboard WebSocket
const ws = new WebSocket('ws://localhost:4000/dashboard-ws');

// Subscribe to data streams
ws.send(JSON.stringify({
  type: 'subscribe',
  streams: ['sales-metrics', 'inventory-status', 'customer-activity']
}));

// Handle real-time updates
ws.on('message', (data) => {
  const message = JSON.parse(data);
  if (message.type === 'data-update') {
    updateDashboard(message.stream, message.data);
  }
});
```

## 🎨 Frontend Integration

### Embedding Widgets

```html
<!-- Include required libraries -->
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.3.0/dist/chart.min.js"></script>

<!-- Dashboard container -->
<div id="dashboard-container">
  <!-- Widgets will be loaded here -->
</div>

<!-- Initialize dashboard -->
<script>
  const dashboard = new DashboardApp();
  dashboard.init();
</script>
```

### Custom Widgets

```javascript
// Create custom widget
class CustomWidget {
  constructor(container, dataType) {
    this.container = container;
    this.dataType = dataType;
    this.websocket = new WebSocket('ws://localhost:4000/dashboard-ws');
    
    this.websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.stream === this.dataType) {
        this.updateWidget(message.data);
      }
    };
  }
  
  updateWidget(data) {
    this.container.innerHTML = this.renderWidget(data);
  }
  
  renderWidget(data) {
    return `<div class="widget">${JSON.stringify(data)}</div>`;
  }
}
```

## 🔧 Configuration

### Environment Variables

```bash
# Database Configuration
DATABASE_URL=postgres://01985dad-5492-710e-a575-76c9bc6f3c98:216d1021-70e6-420a-b7c7-c9b8ff3646fc@eu-central-1.db.thenile.dev/NILEDB

# Server Configuration
PORT=4000
NODE_ENV=production

# Dashboard Settings
DASHBOARD_UPDATE_INTERVAL=5000
DASHBOARD_CACHE_TIMEOUT=300000
```

### Dashboard Service Configuration

```javascript
// Configure dashboard service
const dashboardConfig = {
  updateInterval: 30000,      // 30 seconds
  cacheTimeout: 300000,       // 5 minutes
  maxConnections: 1000,       // WebSocket connections
  rateLimitRpm: 1000,         // Requests per minute
  enableRealTime: true,
  enableNotifications: true
};

await dashboardService.initialize(dashboardConfig);
```

## 📊 Data Models

### Dashboard Metrics
```sql
CREATE TABLE dashboard_metrics (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(100) NOT NULL,
  metric_value DECIMAL(15,2),
  metric_type VARCHAR(50) DEFAULT 'counter',
  timestamp TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Dashboard Events
```sql
CREATE TABLE dashboard_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL,
  event_source VARCHAR(100) DEFAULT 'system',
  severity VARCHAR(20) DEFAULT 'info',
  timestamp TIMESTAMP DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Real-Time Data
```sql
CREATE TABLE real_time_data (
  id SERIAL PRIMARY KEY,
  data_type VARCHAR(100) NOT NULL,
  data_payload JSONB NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '1 hour'),
  created_at TIMESTAMP DEFAULT NOW()
);
```

## 🧪 Testing

### Run Test Suite
```bash
# Comprehensive dashboard tests
node test-dashboard.js

# Test specific components
npm test -- --grep "dashboard"
```

### Test Coverage
- ✅ NileDB Connection & Operations
- ✅ Dashboard Service Functionality
- ✅ WebSocket Real-time Updates
- ✅ API Endpoint Responses
- ✅ Integration Components
- ✅ Error Handling & Recovery

## 🚀 Performance Optimizations

### Backend Optimizations
- **Connection Pooling**: Optimized PostgreSQL connections
- **Data Caching**: 5-minute intelligent cache layer
- **Rate Limiting**: API protection (1000 RPM)
- **Batch Operations**: Grouped database operations
- **Memory Management**: Automatic cleanup of expired data

### Frontend Optimizations
- **Lazy Loading**: Components loaded on demand
- **Chart Optimization**: Efficient Chart.js updates
- **WebSocket Reconnection**: Automatic connection recovery
- **Mobile Optimization**: Responsive design patterns
- **Theme Persistence**: Local storage for user preferences

## 🔒 Security Features

### API Security
- **Rate Limiting**: Express-rate-limit protection
- **Input Validation**: Express-validator sanitization
- **Error Handling**: Secure error messages
- **CORS Protection**: Configurable cross-origin policies

### Data Security
- **PostgreSQL SSL**: Encrypted database connections
- **Parameterized Queries**: SQL injection prevention
- **Session Management**: Secure WebSocket sessions
- **Audit Logging**: Comprehensive activity tracking

## 📱 Mobile Support

### Responsive Design
- **Bootstrap 5**: Mobile-first responsive framework
- **Touch Optimization**: Mobile-friendly interactions
- **Progressive Web App**: PWA capabilities ready
- **Offline Support**: Service worker integration ready

### Mobile Features
- **Swipe Gestures**: Touch-friendly navigation
- **Optimized Charts**: Mobile chart rendering
- **Compact Layouts**: Space-efficient widgets
- **Touch Indicators**: Mobile-specific UI elements

## 🌙 Dark Mode

### Theme Support
```javascript
// Toggle dark mode
function toggleTheme() {
  document.body.classList.toggle('dark-theme');
  localStorage.setItem('dashboard-theme', 
    document.body.classList.contains('dark-theme') ? 'dark' : 'light');
}

// Auto-detect system preference
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.body.classList.add('dark-theme');
}
```

## 📈 Monitoring & Analytics

### Built-in Metrics
- **Performance Tracking**: Response times, throughput
- **Usage Analytics**: Widget interactions, user sessions
- **Error Monitoring**: Real-time error tracking
- **System Health**: CPU, memory, disk usage
- **Business Metrics**: Sales, customers, inventory KPIs

### Health Checks
```bash
# Check dashboard health
curl http://localhost:4000/api/dashboard/health

# Check WebSocket status
curl http://localhost:4000/api/dashboard/websocket/stats
```

## 🔄 Data Flow

### Real-Time Update Flow
1. **Data Change** → Database/System update
2. **Event Trigger** → Dashboard service detects change
3. **WebSocket Broadcast** → All connected clients notified
4. **UI Update** → Frontend widgets refresh automatically
5. **Cache Update** → Local cache refreshed

### API Request Flow
1. **Client Request** → API endpoint called
2. **Rate Limiting** → Request validated and limited
3. **Data Retrieval** → Service fetches data (cache/DB)
4. **Response** → JSON data returned to client
5. **Logging** → Request logged for analytics

## 🚨 Troubleshooting

### Common Issues

**WebSocket Connection Failed**
```javascript
// Check WebSocket URL
const wsUrl = `${protocol}//${host}/dashboard-ws`;
console.log('WebSocket URL:', wsUrl);

// Verify server is running
curl http://localhost:4000/api/dashboard/health
```

**NileDB Connection Issues**
```javascript
// Test NileDB connection
import { testNileConnection } from './src/config/niledb.config.js';
const result = await testNileConnection();
console.log('NileDB Status:', result);
```

**Performance Issues**
```bash
# Check system resources
curl http://localhost:4000/api/dashboard/performance

# Clear cache
curl -X DELETE http://localhost:4000/api/dashboard/cache
```

### Debug Mode
```bash
# Enable debug logging
DEBUG=dashboard:* npm start

# Verbose WebSocket logging
DEBUG=dashboard:websocket npm start
```

## 📖 API Documentation

### Complete API Reference

#### Authentication
Currently uses IP-based rate limiting. For production, implement proper authentication:

```javascript
// Example JWT middleware integration
app.use('/api/dashboard', authenticateJWT);
app.use('/api/dashboard', dashboardRoutes);
```

#### Response Format
All API responses follow this format:
```json
{
  "success": true,
  "data": { /* response data */ },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "filters": { /* applied filters */ }
}
```

#### Error Format
```json
{
  "success": false,
  "error": "Error description",
  "message": "Detailed error message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 🚀 Deployment

### Production Deployment
```bash
# Set production environment
export NODE_ENV=production

# Configure SSL for WebSockets (recommended)
export SSL_CERT_PATH=/path/to/cert.pem
export SSL_KEY_PATH=/path/to/key.pem

# Start with clustering
npm run start
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4000
CMD ["npm", "start"]
```

### Environment Configuration
```bash
# Production settings
NODE_ENV=production
PORT=4000
DATABASE_URL=your_niledb_connection_string

# Optional: Redis for enhanced caching
REDIS_URL=redis://localhost:6379

# Security settings
RATE_LIMIT_MAX=1000
CORS_ORIGIN=https://yourdomain.com
```

## 🤝 Contributing

### Development Setup
```bash
# Clone repository
git clone <repository-url>
cd BACKEND

# Install dependencies
npm install

# Run tests
npm test

# Start development server
npm run dev
```

### Code Style
- ESLint configuration included
- Prettier for code formatting
- JSDoc comments for documentation
- Test coverage minimum 80%

## 📞 Support

### Getting Help
- **Documentation**: This README and inline code comments
- **Testing**: Run `node test-dashboard.js` for comprehensive testing
- **Debugging**: Enable debug mode with `DEBUG=dashboard:*`
- **Issues**: Check the troubleshooting section above

### Feature Requests
The dashboard is designed to be extensible. Common customizations:
- Additional widget types
- Custom data sources
- Advanced filtering options
- Extended export formats
- Integration with external systems

---

## 📄 License

This dashboard system is part of the NXT New Day project. All rights reserved.

---

**Built with ❤️ by the NXT New Day Development Team**

*Last updated: 2024-01-01*