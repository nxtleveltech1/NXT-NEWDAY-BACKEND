# Security Integration Guide - NXT NEW DAY Backend

## Overview

This guide provides step-by-step instructions for integrating the comprehensive security measures implemented in the NXT NEW DAY backend application.

## Table of Contents

1. [Environment Setup](#environment-setup)
2. [Security Service Integration](#security-service-integration)
3. [Database Schema Updates](#database-schema-updates)
4. [Application Integration](#application-integration)
5. [Configuration](#configuration)
6. [Testing](#testing)
7. [Deployment](#deployment)
8. [Monitoring and Maintenance](#monitoring-and-maintenance)

## Environment Setup

### Required Environment Variables

Create or update your `.env` file with the following security-related variables:

```bash
# Encryption Configuration
ENCRYPTION_MASTER_KEY=your-256-bit-encryption-key-here
ENCRYPTION_SALT=your-encryption-salt-here
ENCRYPT_BACKUPS=true

# Backup Configuration
BACKUP_DIRECTORY=./backups
MAX_BACKUP_AGE_DAYS=30

# Redis Configuration (for distributed rate limiting)
REDIS_URL=redis://localhost:6379

# Stack Auth Configuration (already configured)
VITE_STACK_PROJECT_ID=your-stack-project-id

# Database Configuration (already configured)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=nxt_backend
DATABASE_USER=postgres
DATABASE_PASSWORD=your-password

# Optional: External Integrations
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-email@domain.com
SMTP_PASS=your-email-password
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### Install Security Dependencies

The following dependencies have been added to package.json:

```bash
npm install helmet express-slow-down bcrypt argon2 rate-limiter-flexible
```

## Security Service Integration

### 1. Update Main Application (index.js)

Replace the existing index.js with security-enhanced version:

```javascript
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

// Import security configuration
import { securityConfig } from "./src/config/security.config.js";

// Import existing services
import { testConnection } from "./src/config/database.js";
import { realtimeService } from "./src/services/realtime-service.js";
import { analyticsService } from "./src/services/analytics.service.js";
import { integrationMonitoringService } from "./src/services/integration-monitoring.service.js";

// Import routes
import aiRoutes from "./src/routes/ai.routes.js";
import analyticsRoutes from "./src/routes/analytics.routes.js";
import supplierRoutes from "./src/routes/supplier.routes.js";
import customerRoutes from "./src/routes/customer.routes.js";
import supplierPurchaseOrderRoutes from "./src/routes/supplier-purchase-orders.routes.js";
import supplyChainIntegrationRoutes from "./src/routes/supply-chain-integration.routes.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Initialize security services first
await securityConfig.initialize();

// Configure Express with security middleware
securityConfig.configureExpressApp(app);

// Get security middleware
const security = securityConfig.getRouteSecurityMiddleware();

// Basic middleware
app.use(cors());
app.use(express.json());

// Health check endpoint (before authentication)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'NXT NEW DAY Backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    security: securityConfig.getSecurityStatus()
  });
});

// Security status endpoint (admin only)
app.get('/api/security/status', security.adminOnly, (req, res) => {
  res.json(securityConfig.getSecurityStatus());
});

// Mount routes with appropriate security middleware
app.use("/api/suppliers", security.authenticate, supplierRoutes);
app.use("/api/customers", security.authenticate, customerRoutes);
app.use("/api/supplier-purchase-orders", security.authenticate, supplierPurchaseOrderRoutes);
app.use("/api/supply-chain", security.authenticate, supplyChainIntegrationRoutes);
app.use("/api/analytics", security.authenticate, analyticsRoutes);
app.use("/api/analytics/ai", security.authenticate, aiRoutes);

// Real-time WebSocket endpoint for inventory updates
app.get("/api/realtime/stats", security.authenticate, (req, res) => {
  const stats = realtimeService.getConnectionStats();
  res.json(stats);
});

// Server startup with security
async function startServer() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    // Initialize services
    await realtimeService.initialize();
    await analyticsService.initialize();
    
    // Start integration monitoring
    console.log('Starting integration monitoring...');
    await integrationMonitoringService.startMonitoring({ interval: 60000 });
    
    // Create HTTP server
    const server = createServer(app);
    
    // Setup WebSocket server with authentication
    const wss = new WebSocketServer({ 
      server,
      path: '/api/realtime/inventory'
    });

    wss.on('connection', (ws, req) => {
      // WebSocket authentication logic here
      // (existing WebSocket setup with JWT validation)
    });

    // Start server
    server.listen(port, () => {
      console.log(`🚀 NXT Backend running on port ${port}`);
      console.log(`🛡️ Security services active`);
      console.log(`🔗 WebSocket server available at ws://localhost:${port}/api/realtime/inventory`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Graceful shutdown with security cleanup
    const gracefulShutdown = async (signal) => {
      console.log(`${signal} received, shutting down gracefully`);
      
      // Cleanup security services
      await securityConfig.cleanup();
      
      // Cleanup other services
      integrationMonitoringService.stopMonitoring();
      await realtimeService.cleanup();
      
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
```

### 2. Update Database Schema

Add security-related tables to your schema:

```javascript
// Add to src/db/schema.js

import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';

// User roles and permissions tables
export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  level: integer('level').notNull().default(0),
  isSystemRole: boolean('is_system_role').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  category: varchar('category', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow()
});

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').references(() => roles.id).notNull(),
  permissionId: uuid('permission_id').references(() => permissions.id).notNull()
});

export const userRoles = pgTable('user_roles', {
  userId: varchar('user_id', { length: 255 }).notNull(), // Stack Auth user ID
  roleId: uuid('role_id').references(() => roles.id).notNull(),
  assignedAt: timestamp('assigned_at').defaultNow(),
  assignedBy: varchar('assigned_by', { length: 255 })
});

// Security metrics table (already exists as timeSeriesMetrics)
// No changes needed if you already have timeSeriesMetrics table
```

### 3. Run Database Migrations

Create and run the migration for security tables:

```bash
# Generate migration
npm run db:generate

# Apply migration
npm run db:migrate
```

## Application Integration

### 1. Update Existing Routes

Update your existing routes to use the new security middleware. Example for supplier routes:

```javascript
// src/routes/supplier.routes.js - Updated sections

import { requirePermission, requireRole } from '../middleware/rbac.middleware.js';
import { advancedRateLimiting } from '../middleware/security.middleware.js';

// Apply rate limiting to all routes
router.use(advancedRateLimiting.api);

// Example: Admin-only route
router.post('/', [
  requirePermission('suppliers.create'),
  // existing validation middleware
], async (req, res) => {
  // existing route handler
});

// Example: Manager+ access route
router.put('/:id', [
  requirePermission('suppliers.update'),
  // existing validation middleware
], async (req, res) => {
  // existing route handler
});

// Example: Upload with strict rate limiting
router.post('/:id/price-lists', [
  advancedRateLimiting.upload,
  requirePermission('pricelists.create'),
  // existing upload middleware
], async (req, res) => {
  // existing upload handler
});
```

### 2. Update File Upload Handling

Enhance file upload security:

```javascript
// src/routes/supplier.routes.js - File upload section

import { fileUploadSecurity } from '../middleware/security.middleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Use security middleware file type validation
    fileUploadSecurity.validateFileType()(req, { file }, (error) => {
      cb(error, !error);
    });
  }
});

router.post('/:id/price-lists', [
  advancedRateLimiting.upload,
  requirePermission('pricelists.create'),
  upload.single('file'),
  fileUploadSecurity.validateFileType(),
  fileUploadSecurity.scanForMalware()
], async (req, res) => {
  // existing upload handler
});
```

## Configuration

### 1. Initialize User Roles

Create a script to set up initial users and roles:

```javascript
// scripts/setup-security.js

import { rbacService } from '../src/middleware/rbac.middleware.js';

async function setupInitialSecurity() {
  try {
    await rbacService.initialize();
    
    // Assign roles to existing users
    // Replace with actual user IDs from Stack Auth
    const adminUserId = 'your-admin-user-id';
    const managerUserId = 'your-manager-user-id';
    
    await rbacService.assignRole(adminUserId, 'admin');
    await rbacService.assignRole(managerUserId, 'manager');
    
    console.log('✅ Initial security setup completed');
  } catch (error) {
    console.error('❌ Security setup failed:', error);
  }
}

setupInitialSecurity();
```

### 2. Backup Configuration

Create backup directories and test backup functionality:

```bash
# Create backup directories
mkdir -p backups/{database,files,full,incremental,temp}

# Test backup functionality
npm run backup:test
```

### 3. Security Configuration Validation

```bash
# Check security configuration
npm run security:check

# View security status
npm run security:status

# Generate security report
npm run security:report
```

## Testing

### 1. Security Health Check

```bash
# Run comprehensive security check
npm run security:check
```

### 2. Test Individual Components

```bash
# Test encryption
npm run encryption:test

# Test backup and recovery
npm run backup:test

# Test database operations
npm run db:validate
```

### 3. Integration Testing

Create test scripts to verify security integration:

```javascript
// __tests__/security-integration.test.js

import request from 'supertest';
import { app } from '../index.js';

describe('Security Integration', () => {
  test('should require authentication for protected routes', async () => {
    const response = await request(app)
      .get('/api/suppliers')
      .expect(401);
    
    expect(response.body.error).toBe('Authentication required');
  });

  test('should apply rate limiting', async () => {
    // Test rate limiting by making multiple requests
  });

  test('should validate input properly', async () => {
    // Test input validation
  });
});
```

## Deployment

### 1. Production Environment Variables

Ensure all production environment variables are set:

```bash
# Production .env file
NODE_ENV=production
ENCRYPTION_MASTER_KEY=your-production-key
DATABASE_URL=your-production-db-url
REDIS_URL=your-production-redis-url
```

### 2. SSL/TLS Configuration

Configure SSL certificates and HTTPS:

```javascript
// For production, use HTTPS
import https from 'https';
import fs from 'fs';

const options = {
  key: fs.readFileSync('path/to/private-key.pem'),
  cert: fs.readFileSync('path/to/certificate.pem')
};

const server = https.createServer(options, app);
```

### 3. Docker Configuration

Update Dockerfile with security considerations:

```dockerfile
# Dockerfile
FROM node:18-alpine

# Add security updates
RUN apk update && apk upgrade

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nxtapp -u 1001

# Set working directory
WORKDIR /app

# Copy and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY --chown=nxtapp:nodejs . .

# Switch to non-root user
USER nxtapp

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

# Start application
CMD ["npm", "start"]
```

## Monitoring and Maintenance

### 1. Security Monitoring

Set up monitoring dashboards:

```bash
# View security dashboard
npm run monitoring:dashboard

# Check for security alerts
npm run security:status | jq '.services.monitoring.activeAlerts'
```

### 2. Regular Maintenance

Schedule regular security maintenance:

```bash
# Daily backup
npm run backup:database

# Weekly full backup
npm run backup:full

# Monthly cleanup
npm run backup:cleanup

# Quarterly security review
npm run security:report
```

### 3. Log Analysis

Monitor security logs for threats:

```bash
# Example log analysis queries
grep "SECURITY_ALERT" logs/app.log
grep "RATE_LIMIT_EXCEEDED" logs/app.log
grep "AUTHENTICATION_FAILURE" logs/app.log
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   ```bash
   # Check Stack Auth configuration
   echo $VITE_STACK_PROJECT_ID
   curl -f https://api.stack-auth.com/api/v1/projects/$VITE_STACK_PROJECT_ID/.well-known/jwks.json
   ```

2. **Rate Limiting Issues**
   ```bash
   # Check Redis connection
   redis-cli ping
   ```

3. **Backup Failures**
   ```bash
   # Check backup directory permissions
   ls -la backups/
   npm run backup:test
   ```

4. **Database Connection Issues**
   ```bash
   # Test database connection
   npm run db:check
   npm run health:check
   ```

### Security Incident Response

If security issues arise:

1. **Immediate Response**
   ```bash
   # Activate emergency lockdown
   node -e "import('./src/config/security.config.js').then(m => m.securityConfig.emergencyLockdown('Security incident detected'))"
   ```

2. **Investigation**
   ```bash
   # Generate security report
   npm run security:report
   
   # Check security dashboard
   npm run monitoring:dashboard
   ```

3. **Recovery**
   ```bash
   # Restore from backup if needed
   npm run backup:database
   ```

## Conclusion

This security integration provides comprehensive protection for the NXT NEW DAY backend application. Follow this guide carefully to ensure all security measures are properly implemented and configured.

For additional support or security questions, refer to the [Security Procedures Documentation](./SECURITY_PROCEDURES.md) or contact the security team.

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Next Review**: April 2025