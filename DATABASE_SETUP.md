# NXT NEW DAY Database Setup and Migration Guide

## Overview

This guide covers the complete database setup for NXT NEW DAY, including migration from Supabase to Neon Postgres using Drizzle ORM. The system implements a comprehensive inventory management platform with real-time tracking, analytics, and supplier integration.

## Quick Start

### Prerequisites
- Node.js 18+ installed
- Neon account and database instance
- Environment variables configured

### Setup Steps
1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Neon connection string
   ```

3. **Run Migrations**
   ```bash
   npm run db:migrate
   ```

4. **Verify Setup**
   ```bash
   npm run db:check
   ```

## Database Configuration

### Environment Variables
```bash
# Required
DATABASE_URL=postgres://username:password@ep-ancient-star-76670449.eu-central-1.aws.neon.tech/dbname?sslmode=require

# Optional
NODE_ENV=development
```

### Connection Pool Settings
- **Max Connections**: 10
- **Idle Timeout**: 30 seconds
- **Connection Timeout**: 2 seconds
- **SSL**: Auto-configured based on environment

## Schema Architecture

### Core Modules

#### 1. Customer Management
**Table**: `customers`
- **Purpose**: Comprehensive customer data with purchase history
- **Key Features**:
  - UUID primary keys for scalability
  - JSONB metadata for flexible data storage
  - Purchase history tracking
  - Address management
  - Performance indexes on code, email, company name

#### 2. Supplier Management (Unified)
**Table**: `suppliers`
- **Purpose**: Unified vendor and supplier management
- **Key Features**:
  - Consolidates legacy vendor/supplier entities
  - Performance rating and lead time tracking
  - Approval workflow support
  - Business classification (vendor, manufacturer, distributor)
  - Payment terms and credit management

#### 3. Inventory Management
**Tables**: `inventory`, `inventory_movements`
- **Purpose**: Real-time inventory tracking
- **Key Features**:
  - Multi-warehouse support
  - Stock levels (on-hand, available, reserved, in-transit)
  - Movement history and audit trail
  - Reorder point management
  - Real-time status tracking

#### 4. Price Management
**Tables**: `price_lists`, `price_list_items`
- **Purpose**: Supplier price list management
- **Key Features**:
  - Version control for price lists
  - Multiple format support (CSV, Excel, PDF, XML)
  - Validation and approval workflow
  - Effective date management
  - Tier pricing support

#### 5. Analytics & Reporting
**Tables**: `analytics_daily_aggregates`, `analytics_monthly_aggregates`, `time_series_metrics`
- **Purpose**: Multi-dimensional analytics
- **Key Features**:
  - Daily/monthly aggregations
  - Time-series data collection
  - Performance metrics tracking
  - Real-time analytics support

## Available Commands

### Migration Management
```bash
# Generate new migration
npm run db:generate

# Apply migrations
npm run db:migrate

# Push schema changes (development)
npm run db:push

# Open Drizzle Studio
npm run db:studio
```

### Schema Operations
```bash
# Check schema status
npm run db:check

# Drop database (destructive)
npm run db:drop
```

### Backup & Recovery
```bash
# Create manual backup
npm run db:backup

# Create checkpoint
npm run db:checkpoint

# Rollback to previous version
npm run db:rollback

# Check current schema version
npm run db:status

# Validate data integrity
npm run db:validate
```

### Testing & Performance
```bash
# Run database tests
npm test

# Performance benchmarks
npm run perf:analytics

# Profile database operations
npm run perf:profile

# Comprehensive validation
npm run validate:performance
```

## Migration Strategy

### From Supabase to Neon

1. **Schema Migration**
   - All tables recreated with Drizzle ORM
   - Indexes optimized for Neon Postgres
   - Foreign key relationships established

2. **Data Migration**
   - Custom migration scripts in `src/db/migrations/`
   - Validation procedures for data integrity
   - Rollback capabilities for safety

3. **Vendor/Supplier Consolidation**
   - Legacy vendor data merged into suppliers table
   - Metadata field preserves original vendor information
   - Business logic updated to handle unified model

### Migration Files
- `0000_medical_maddog.sql` - Initial schema creation
- `0001_unified_supplier_module.sql` - Supplier consolidation
- `migration-helper.js` - Utility functions
- `sample-data.js` - Test data generation
- `supabase-migration.js` - Data migration from Supabase

## Troubleshooting

### Common Issues

1. **Connection Failures**
   ```bash
   # Test connection
   npm run db:check
   
   # Verify environment variables
   echo $DATABASE_URL
   ```

2. **Migration Errors**
   ```bash
   # Check migration status
   npm run db:status
   
   # Rollback if needed
   npm run db:rollback
   ```

3. **Performance Issues**
   ```bash
   # Run performance analysis
   npm run perf:benchmark
   
   # Check query plans in Drizzle Studio
   npm run db:studio
   ```

## Performance Optimization

### Indexes
All tables include strategic indexes for:
- Primary key lookups
- Foreign key relationships
- Common query patterns
- Search operations

### Query Optimization
- Connection pooling for concurrent requests
- Prepared statements via Drizzle ORM
- Efficient joins and aggregations
- Real-time notification triggers

### Monitoring
- Query performance tracking
- Connection pool monitoring
- Error logging and alerting
- Performance benchmarking tools

## Security

### Access Control
- Environment-based configuration
- SSL/TLS encryption in production
- Connection string security
- API rate limiting

### Data Protection
- UUID primary keys prevent enumeration
- JSONB for sensitive metadata
- Audit trails for all changes
- Backup and recovery procedures

## File Structure

```
BACKEND/
├── src/db/
│   ├── schema.js              # Complete database schema
│   ├── index.js               # Database connection and helpers
│   ├── migrations/            # Migration files
│   │   ├── 0000_medical_maddog.sql
│   │   ├── 0001_unified_supplier_module.sql
│   │   ├── migration-helper.js
│   │   ├── sample-data.js
│   │   └── supabase-migration.js
│   ├── inventory-queries.js   # Inventory operations
│   ├── customer-queries.js    # Customer operations
│   └── supplier-queries.js    # Supplier operations
├── drizzle.config.js          # Drizzle configuration
└── .env.example               # Environment template
```

## Support and Maintenance

### Regular Tasks
- Weekly performance reviews
- Monthly backup validation
- Quarterly schema optimization
- Annual security audits

### Monitoring Metrics
- Query execution times
- Connection pool utilization
- Error rates and types
- Data growth patterns

For additional support, refer to:
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Neon Documentation](https://neon.tech/docs)
- Project issue tracker