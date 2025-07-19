# NXT NEW DAY - Migration Execution Manual

## Overview

This manual provides step-by-step procedures for executing the complete data migration from legacy systems to the NXT NEW DAY platform. It is designed for production deployment and includes all necessary commands, validations, and troubleshooting procedures.

**Version:** 1.0.0  
**Last Updated:** 2025-01-19  
**Migration Agent:** Data Migration Agent  
**Environment:** Production Ready  

---

## Pre-Migration Requirements

### System Requirements

#### Database Servers
- **Source Database**: PostgreSQL 12+ or MySQL 8+
- **Target Database**: Neon PostgreSQL (latest version)
- **Backup Database**: Neon PostgreSQL with point-in-time recovery

#### Infrastructure Requirements
- **Memory**: Minimum 8GB RAM, Recommended 16GB+
- **CPU**: Minimum 4 cores, Recommended 8+ cores
- **Storage**: 2x source database size for temporary files and backups
- **Network**: Stable connection with < 50ms latency between databases

#### Software Dependencies
```bash
# Node.js and npm
node --version  # Should be 18.x or higher
npm --version   # Should be 9.x or higher

# Required packages (installed via npm install)
drizzle-orm
pg
dotenv
```

### Environment Setup

#### 1. Environment Variables
Create and configure the `.env` file:

```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

Required environment variables:
```env
# Source Database (Legacy System)
SOURCE_DATABASE_URL=postgres://user:password@source-host:5432/legacy_db

# Target Database (NXT NEW DAY)
DATABASE_URL=postgres://user:password@ep-xxx.neon.tech/nxt_production?sslmode=require

# Backup Database
BACKUP_DATABASE_URL=postgres://user:password@ep-xxx.neon.tech/nxt_backup?sslmode=require

# Migration Configuration
NODE_ENV=production
MIGRATION_BATCH_SIZE=1000
MIGRATION_TIMEOUT=300000
MIGRATION_MAX_RETRIES=3

# Monitoring
ENABLE_REAL_TIME_MONITORING=true
MIGRATION_LOG_LEVEL=INFO
```

#### 2. Database Connectivity Verification
```bash
# Test all database connections
npm run migration:test-connections

# Expected output:
# ✅ Source database connection: OK
# ✅ Target database connection: OK  
# ✅ Backup database connection: OK
# ✅ Schema validation: OK
```

#### 3. Schema Validation
```bash
# Verify target schema is properly deployed
npm run db:status

# Verify all required tables exist
npm run migration:validate-schema
```

---

## Migration Execution Procedure

### Phase 1: Pre-Migration Preparation

#### Step 1.1: Final System Validation
```bash
# Run comprehensive pre-migration validation
npm run migration:validate-all

# Command details:
# - Validates source data quality
# - Checks target schema readiness
# - Verifies backup systems
# - Tests rollback procedures
# - Confirms resource availability
```

**Expected Results:**
- Data quality score: > 95%
- Critical validation errors: 0
- Schema compatibility: 100%
- Backup system: Ready

**If validation fails:**
1. Review validation report: `/tmp/pre-migration-validation-report.json`
2. Address critical issues before proceeding
3. Re-run validation until all checks pass

#### Step 1.2: Create System Backup
```bash
# Create comprehensive backup of target database
npm run migration:create-backup

# This command:
# - Creates point-in-time backup
# - Verifies backup integrity
# - Documents backup location and timestamp
# - Tests restore procedures
```

**Backup Verification:**
```bash
# Verify backup was created successfully
npm run migration:verify-backup

# Expected output:
# ✅ Backup created: backup_2025-01-19_10-30-00
# ✅ Backup size: 2.3GB
# ✅ Backup integrity: Verified
# ✅ Restore test: Passed
```

#### Step 1.3: Initialize Migration Session
```bash
# Start migration monitoring and logging
npm run migration:start-session --name="Production_Migration_2025-01-19"

# This command:
# - Initializes migration dashboard
# - Starts real-time monitoring
# - Creates migration session tracking
# - Prepares rollback checkpoints
```

### Phase 2: Core Data Migration

#### Step 2.1: Customer Data Migration
```bash
# Execute customer migration
npm run migration:customers

# Monitor progress in real-time
npm run migration:status

# Expected output:
# 🔄 Migrating customers...
# 📊 Progress: 1,250/5,000 customers (25%)
# ⏱️  Processing rate: 85 records/sec
# ✅ Customer migration completed: 5,000 records migrated
```

**Validation Commands:**
```bash
# Validate customer migration results
npm run migration:validate-customers

# Check record counts
npm run migration:compare-counts --table=customers

# Expected output:
# Source customers: 5,000
# Target customers: 5,000
# ✅ Record counts match
```

**If migration fails:**
```bash
# Check error logs
npm run migration:logs --table=customers

# Retry failed records
npm run migration:retry --table=customers

# If critical failure, initiate rollback
npm run migration:rollback --table=customers
```

#### Step 2.2: Supplier Data Migration
```bash
# Execute supplier migration (includes vendor consolidation)
npm run migration:suppliers

# This includes:
# - Legacy suppliers migration
# - Legacy vendors migration and consolidation
# - Duplicate detection and resolution
# - Relationship mapping
```

**Monitoring Supplier Consolidation:**
```bash
# Check consolidation progress
npm run migration:status --table=suppliers

# Expected output:
# 🔄 Processing suppliers...
# 📦 Legacy suppliers: 2,500 → 2,500 migrated
# 🏭 Legacy vendors: 1,200 → 1,200 consolidated as suppliers
# 🔗 Relationships mapped: 3,700/3,700
# ✅ Supplier consolidation completed
```

**Validation Commands:**
```bash
# Validate supplier migration and consolidation
npm run migration:validate-suppliers

# Check for duplicate supplier codes
npm run migration:check-duplicates --table=suppliers

# Verify vendor consolidation
npm run migration:verify-consolidation
```

#### Step 2.3: Product Data Migration
```bash
# Execute product migration
npm run migration:products

# This includes:
# - Product catalog migration
# - Supplier relationship mapping
# - SKU uniqueness validation
# - Metadata preservation
```

**Product-Supplier Relationship Validation:**
```bash
# Validate product-supplier relationships
npm run migration:validate-relationships --type=product-supplier

# Expected output:
# 🔗 Checking product-supplier relationships...
# ✅ Valid relationships: 18,500/18,500
# ⚠️  Orphaned products: 0
# ✅ All relationships validated
```

#### Step 2.4: Inventory Data Migration
```bash
# Execute inventory migration
npm run migration:inventory

# This includes:
# - Inventory levels migration
# - Stock status calculation
# - Warehouse and location mapping
# - Real-time tracking setup
```

**Inventory Validation:**
```bash
# Validate inventory consistency
npm run migration:validate-inventory

# Check inventory calculations
npm run migration:verify-stock-calculations

# Expected output:
# ✅ Quantity calculations: Consistent
# ✅ Stock status: Accurate
# ✅ Warehouse mappings: Valid
```

#### Step 2.5: Price List Migration
```bash
# Execute price list migration
npm run migration:price-lists

# Execute price list items migration
npm run migration:price-list-items

# This includes:
# - Price list structure migration
# - Item-level pricing migration
# - Currency conversion
# - Tier pricing setup
```

**Pricing Validation:**
```bash
# Validate pricing data
npm run migration:validate-pricing

# Check price list completeness
npm run migration:verify-price-completeness

# Expected output:
# ✅ Price lists: 150 migrated
# ✅ Price list items: 45,000 migrated
# ✅ Currency validation: Passed
# ✅ Tier pricing: Configured
```

#### Step 2.6: Upload History Migration
```bash
# Execute upload history migration
npm run migration:upload-history

# This includes:
# - File upload metadata
# - Processing status history
# - Error and warning logs
# - Supplier associations
```

### Phase 3: Post-Migration Validation

#### Step 3.1: Comprehensive Data Validation
```bash
# Run complete data validation suite
npm run migration:validate-complete

# This performs:
# - Record count verification
# - Data integrity checks
# - Relationship validation
# - Business rule validation
# - Performance benchmarks
```

**Expected Validation Results:**
```
📊 Migration Validation Report
=====================================
✅ Record Counts: All tables match source
✅ Data Integrity: 100% - No corruption detected
✅ Relationships: All foreign keys valid
✅ Business Rules: All constraints satisfied
✅ Performance: Queries within expected ranges
⚠️  Warnings: 3 non-critical formatting issues
📈 Overall Score: 99.8% - Migration Successful
```

#### Step 3.2: Business Rule Validation
```bash
# Validate business-specific rules
npm run migration:validate-business-rules

# This checks:
# - Price consistency rules
# - Inventory logic rules
# - Supplier approval workflows
# - Customer categorization rules
```

#### Step 3.3: Performance Validation
```bash
# Run performance benchmarks
npm run migration:test-performance

# Expected benchmarks:
# - Customer lookup: < 50ms
# - Product search: < 100ms  
# - Inventory queries: < 200ms
# - Price list retrieval: < 150ms
```

### Phase 4: Finalization

#### Step 4.1: Index Optimization
```bash
# Rebuild and optimize indexes
npm run db:analyze-all

# Update table statistics
npm run db:vacuum-analyze

# Expected output:
# ✅ Indexes rebuilt: 47 indexes optimized
# ✅ Statistics updated: All tables analyzed
# ✅ Query performance: Optimized
```

#### Step 4.2: Migration Report Generation
```bash
# Generate comprehensive migration report
npm run migration:generate-report

# Generate executive summary
npm run migration:generate-summary

# Reports saved to:
# - /tmp/migration-report-2025-01-19.json
# - /tmp/migration-summary-2025-01-19.html
# - /tmp/migration-report-2025-01-19.pdf
```

#### Step 4.3: Session Cleanup
```bash
# Stop migration monitoring
npm run migration:stop-session

# Clean up temporary files
npm run migration:cleanup

# Archive migration logs
npm run migration:archive-logs
```

---

## Monitoring and Progress Tracking

### Real-Time Dashboard

#### Starting the Dashboard
```bash
# Start real-time migration dashboard
npm run migration:dashboard

# Access dashboard at: http://localhost:3001/migration-dashboard
# Default credentials: admin / migration2025
```

#### Dashboard Features
- **Live Progress**: Real-time migration progress by table
- **Performance Metrics**: Processing rates, error rates, throughput
- **System Resources**: Memory usage, CPU utilization, connection pools
- **Error Tracking**: Real-time error logs and warnings
- **Time Estimates**: Remaining time calculations

### Command Line Monitoring

#### Progress Checking
```bash
# Check overall migration progress
npm run migration:progress

# Check specific table progress
npm run migration:progress --table=customers

# Check error summary
npm run migration:errors --summary

# Check performance metrics
npm run migration:metrics
```

#### Log Analysis
```bash
# View migration logs in real-time
npm run migration:logs --follow

# View errors only
npm run migration:logs --level=error

# View logs for specific table
npm run migration:logs --table=suppliers
```

---

## Error Handling and Recovery

### Common Error Scenarios

#### Error: High Error Rate (> 5%)
**Symptoms:** Many records failing validation or transformation
```bash
# Diagnose error patterns
npm run migration:analyze-errors

# Common causes and solutions:
# 1. Data quality issues → Run data cleanup
# 2. Schema mismatches → Verify schema version
# 3. Connection issues → Check network stability
```

**Recovery Steps:**
```bash
# 1. Pause migration
npm run migration:pause

# 2. Analyze specific errors
npm run migration:error-details --table=customers

# 3. Fix data or configuration issues
npm run migration:fix-data-quality

# 4. Resume migration
npm run migration:resume
```

#### Error: Migration Timeout
**Symptoms:** Migration process exceeds time limits
```bash
# Check current migration status
npm run migration:status

# Increase timeout if needed
npm run migration:configure --timeout=600000

# Or restart with optimized settings
npm run migration:restart --optimized
```

#### Error: Memory Exhaustion
**Symptoms:** Out of memory errors during processing
```bash
# Check memory usage
npm run migration:memory-status

# Reduce batch size
npm run migration:configure --batch-size=500

# Restart with reduced load
npm run migration:restart --low-memory
```

#### Error: Connection Failures
**Symptoms:** Database connection drops during migration
```bash
# Test all connections
npm run migration:test-connections

# Restart with connection retry logic
npm run migration:restart --auto-retry

# Check network stability
npm run migration:network-test
```

### Rollback Procedures

#### Automatic Rollback Triggers
- Critical validation failure (> 10% error rate)
- Data corruption detection
- Migration timeout (> 4 hours)
- Memory exhaustion errors
- Manual intervention required

#### Manual Rollback Commands

##### Complete Rollback (Full Database Restore)
```bash
# Initiate complete rollback
npm run migration:rollback --full

# This will:
# 1. Stop all migration processes
# 2. Restore database from backup
# 3. Verify restore integrity
# 4. Generate rollback report
```

##### Selective Rollback (Specific Tables)
```bash
# Rollback specific tables
npm run migration:rollback --tables=customers,suppliers

# Rollback last migration step
npm run migration:rollback --last-step

# Rollback to specific checkpoint
npm run migration:rollback --checkpoint=customers_completed
```

##### Verify Rollback Success
```bash
# Verify rollback completed successfully
npm run migration:verify-rollback

# Check data consistency after rollback
npm run migration:validate-post-rollback

# Generate rollback report
npm run migration:rollback-report
```

---

## Performance Optimization

### Pre-Migration Optimization

#### Source Database Optimization
```bash
# Create temporary indexes for migration queries
npm run migration:create-temp-indexes

# Analyze source database performance
npm run migration:analyze-source-performance

# Optimize source queries
npm run migration:optimize-source-queries
```

#### Target Database Preparation
```bash
# Pre-create all indexes
npm run db:create-indexes

# Configure connection pooling
npm run db:configure-pools

# Set migration-specific settings
npm run db:configure-migration
```

### During Migration Optimization

#### Batch Size Optimization
```bash
# Auto-optimize batch sizes based on performance
npm run migration:auto-optimize

# Manually set optimal batch sizes
npm run migration:configure --batch-sizes="customers:1000,suppliers:500,products:2000"
```

#### Parallel Processing
```bash
# Enable parallel processing for independent tables
npm run migration:enable-parallel --tables=customers,suppliers

# Monitor parallel processing performance
npm run migration:parallel-status
```

### Post-Migration Optimization

#### Index Rebuilding
```bash
# Rebuild all indexes with latest statistics
npm run db:rebuild-indexes

# Analyze query performance
npm run db:analyze-query-performance

# Update database statistics
npm run db:update-statistics
```

---

## Testing and Validation

### Pre-Production Testing

#### Staging Environment Testing
```bash
# Run comprehensive test suite on staging data
npm run migration:test-staging

# Test specific scenarios
npm run migration:test --scenario=clean_migration
npm run migration:test --scenario=dirty_data_migration
npm run migration:test --scenario=performance_stress
```

#### Data Sample Testing
```bash
# Test migration with data samples
npm run migration:test-sample --size=small    # 1K records
npm run migration:test-sample --size=medium   # 10K records
npm run migration:test-sample --size=large    # 100K records
```

### Production Validation

#### Automated Validation Suite
```bash
# Run all validation checks
npm run migration:validate-all

# Individual validation components
npm run migration:validate-data-integrity
npm run migration:validate-business-rules
npm run migration:validate-performance
npm run migration:validate-relationships
```

#### Manual Validation Steps

1. **Record Count Verification**
   ```bash
   npm run migration:verify-counts
   ```

2. **Sample Data Verification**
   ```bash
   npm run migration:verify-samples --count=100
   ```

3. **Relationship Integrity**
   ```bash
   npm run migration:verify-relationships
   ```

4. **Business Logic Testing**
   ```bash
   npm run migration:test-business-logic
   ```

---

## Troubleshooting Guide

### Diagnostic Commands

#### System Diagnostics
```bash
# Check system resources
npm run migration:system-check

# Database connection diagnostics
npm run migration:connection-check

# Schema validation diagnostics
npm run migration:schema-check

# Performance diagnostics
npm run migration:performance-check
```

#### Migration State Diagnostics
```bash
# Check migration state
npm run migration:state-check

# Verify data consistency
npm run migration:consistency-check

# Check for orphaned records
npm run migration:orphan-check

# Verify constraint compliance
npm run migration:constraint-check
```

### Common Issues and Solutions

#### Issue: Duplicate Key Violations
**Solution:**
```bash
# Identify duplicate keys
npm run migration:find-duplicates --table=customers

# Resolve duplicates automatically
npm run migration:resolve-duplicates --table=customers --strategy=merge

# Manual duplicate resolution
npm run migration:resolve-duplicates --table=customers --strategy=manual
```

#### Issue: Foreign Key Constraint Violations
**Solution:**
```bash
# Find orphaned records
npm run migration:find-orphans

# Create missing parent records
npm run migration:create-missing-parents

# Remove orphaned records
npm run migration:remove-orphans --confirm
```

#### Issue: Data Type Conversion Errors
**Solution:**
```bash
# Identify conversion errors
npm run migration:analyze-conversion-errors

# Apply data type fixes
npm run migration:fix-data-types

# Retry migration with type coercion
npm run migration:retry --coerce-types
```

#### Issue: Performance Degradation
**Solution:**
```bash
# Identify performance bottlenecks
npm run migration:performance-analysis

# Optimize slow queries
npm run migration:optimize-queries

# Increase resource allocation
npm run migration:scale-resources --memory=16GB --cpu=8
```

---

## Security and Compliance

### Security Measures

#### Connection Security
- All database connections use SSL/TLS encryption
- Connection strings stored in encrypted environment variables
- Regular credential rotation recommended

#### Data Protection
```bash
# Encrypt sensitive data during migration
npm run migration:enable-encryption

# Anonymize test data
npm run migration:anonymize-test-data

# Audit trail logging
npm run migration:enable-audit-logging
```

#### Access Control
```bash
# Verify user permissions
npm run migration:check-permissions

# Create migration-specific user
npm run migration:create-migration-user

# Revoke temporary permissions after migration
npm run migration:revoke-temp-permissions
```

### Compliance Requirements

#### Data Retention
- Migration logs retained for 90 days
- Backup data retained according to compliance requirements
- Personal data handling follows GDPR guidelines

#### Audit Trail
```bash
# Generate audit trail report
npm run migration:audit-report

# Export compliance documentation
npm run migration:export-compliance-docs

# Verify regulatory compliance
npm run migration:compliance-check
```

---

## Migration Checklist

### Pre-Migration Checklist

**Environment Setup**
- [ ] Node.js 18+ installed and verified
- [ ] All required npm packages installed
- [ ] Environment variables configured and tested
- [ ] Database connections verified (source, target, backup)
- [ ] Schema deployment completed and validated
- [ ] Backup system tested and verified

**Data Preparation**
- [ ] Source data quality assessment completed
- [ ] Critical data issues resolved
- [ ] Test migration executed successfully
- [ ] Performance benchmarks established
- [ ] Rollback procedures tested

**Infrastructure Readiness**
- [ ] Sufficient server resources allocated (8GB+ RAM, 4+ CPU cores)
- [ ] Network connectivity stable (< 50ms latency)
- [ ] Monitoring systems configured
- [ ] Alert thresholds configured
- [ ] Temporary storage space available (2x database size)

**Team Preparation**
- [ ] Migration team trained on procedures
- [ ] Emergency contacts identified
- [ ] Communication plan activated
- [ ] Stakeholder notifications sent
- [ ] Go/No-go decision meeting completed

### During Migration Checklist

**Migration Execution**
- [ ] Migration session started and logging active
- [ ] Real-time monitoring dashboard active
- [ ] Customer migration completed and validated
- [ ] Supplier migration completed and validated
- [ ] Product migration completed and validated
- [ ] Inventory migration completed and validated
- [ ] Price list migration completed and validated
- [ ] Upload history migration completed and validated

**Quality Assurance**
- [ ] Record counts verified for each table
- [ ] Data integrity validation passed
- [ ] Relationship integrity validated
- [ ] Business rule compliance verified
- [ ] Performance benchmarks met
- [ ] Error rates within acceptable limits (< 5%)

**Monitoring and Control**
- [ ] Migration progress tracked in real-time
- [ ] System resource utilization monitored
- [ ] Error patterns identified and addressed
- [ ] Performance metrics within expected ranges
- [ ] Backup systems operational
- [ ] Rollback readiness maintained

### Post-Migration Checklist

**Data Validation**
- [ ] Comprehensive data validation suite executed
- [ ] Business rule validation completed
- [ ] Performance validation completed
- [ ] Sample data verification completed
- [ ] Stakeholder acceptance testing passed

**System Optimization**
- [ ] Database indexes rebuilt and optimized
- [ ] Query performance validated
- [ ] Connection pooling optimized
- [ ] Cache configurations updated
- [ ] System statistics updated

**Documentation and Reporting**
- [ ] Migration report generated and reviewed
- [ ] Executive summary prepared
- [ ] Technical documentation updated
- [ ] Lessons learned documented
- [ ] Compliance documentation completed

**Operational Readiness**
- [ ] Application systems tested with new database
- [ ] User acceptance testing completed
- [ ] Training materials updated
- [ ] Support procedures updated
- [ ] Monitoring systems configured for production

**Cleanup and Finalization**
- [ ] Temporary files and resources cleaned up
- [ ] Migration tools and scripts archived
- [ ] Access permissions reviewed and updated
- [ ] Security audit completed
- [ ] Project closure documentation completed

---

## Emergency Procedures

### Emergency Contacts

```
Primary Migration Lead: [Name] - [Phone] - [Email]
Database Administrator: [Name] - [Phone] - [Email]
Systems Administrator: [Name] - [Phone] - [Email]
Business Stakeholder: [Name] - [Phone] - [Email]
Escalation Manager: [Name] - [Phone] - [Email]
```

### Emergency Scenarios

#### Critical Failure - Immediate Rollback Required
1. **Execute Immediate Stop**
   ```bash
   npm run migration:emergency-stop
   ```

2. **Initiate Full Rollback**
   ```bash
   npm run migration:emergency-rollback
   ```

3. **Notify Stakeholders**
   ```bash
   npm run migration:emergency-notify
   ```

4. **Document Incident**
   ```bash
   npm run migration:incident-report
   ```

#### Data Corruption Detected
1. **Isolate Affected Systems**
   ```bash
   npm run migration:isolate-corruption
   ```

2. **Assess Corruption Extent**
   ```bash
   npm run migration:assess-corruption
   ```

3. **Execute Targeted Rollback**
   ```bash
   npm run migration:rollback-corrupted-data
   ```

4. **Verify System Integrity**
   ```bash
   npm run migration:verify-integrity
   ```

#### System Resource Exhaustion
1. **Scale Resources Immediately**
   ```bash
   npm run migration:emergency-scale
   ```

2. **Reduce Migration Load**
   ```bash
   npm run migration:reduce-load
   ```

3. **Monitor Recovery**
   ```bash
   npm run migration:monitor-recovery
   ```

---

## Appendices

### Appendix A: Command Reference

#### Migration Commands
```bash
# Core migration commands
npm run migration:customers          # Migrate customer data
npm run migration:suppliers          # Migrate supplier data  
npm run migration:products           # Migrate product data
npm run migration:inventory          # Migrate inventory data
npm run migration:price-lists        # Migrate price lists
npm run migration:price-list-items   # Migrate price list items
npm run migration:upload-history     # Migrate upload history

# Control commands
npm run migration:start-session      # Start migration session
npm run migration:stop-session       # Stop migration session
npm run migration:pause              # Pause migration
npm run migration:resume             # Resume migration
npm run migration:restart            # Restart migration

# Validation commands
npm run migration:validate-all       # Run all validations
npm run migration:validate-customers # Validate customer data
npm run migration:validate-suppliers # Validate supplier data
npm run migration:validate-relationships # Validate relationships

# Monitoring commands
npm run migration:status             # Check migration status
npm run migration:progress           # Check progress
npm run migration:logs               # View logs
npm run migration:metrics            # View metrics
npm run migration:dashboard          # Start dashboard

# Rollback commands
npm run migration:rollback --full    # Full rollback
npm run migration:rollback --table=X # Table-specific rollback
npm run migration:rollback --last-step # Rollback last step

# Utility commands
npm run migration:test-connections   # Test database connections
npm run migration:create-backup      # Create backup
npm run migration:cleanup            # Clean up temporary files
npm run migration:generate-report    # Generate reports
```

#### Database Commands
```bash
# Schema management
npm run db:status                    # Check database status
npm run db:migrate                   # Run schema migrations
npm run db:rollback                  # Rollback schema
npm run db:generate                  # Generate new migration

# Optimization
npm run db:analyze                   # Analyze database
npm run db:vacuum                    # Vacuum database
npm run db:rebuild-indexes           # Rebuild indexes
npm run db:update-statistics         # Update statistics

# Backup and restore
npm run db:backup                    # Create backup
npm run db:restore                   # Restore from backup
npm run db:verify-backup             # Verify backup integrity
```

### Appendix B: Configuration Templates

#### Environment Configuration Template
```env
# Database Connections
SOURCE_DATABASE_URL=postgres://user:pass@host:port/db
DATABASE_URL=postgres://user:pass@host:port/db
BACKUP_DATABASE_URL=postgres://user:pass@host:port/db

# Migration Settings
MIGRATION_BATCH_SIZE=1000
MIGRATION_TIMEOUT=300000
MIGRATION_MAX_RETRIES=3
MIGRATION_PARALLEL_ENABLED=true
MIGRATION_PARALLEL_MAX_CONCURRENT=3

# Monitoring
ENABLE_REAL_TIME_MONITORING=true
MIGRATION_LOG_LEVEL=INFO
MIGRATION_PROGRESS_INTERVAL=5000
MIGRATION_HEALTH_CHECK_INTERVAL=30000

# Performance
DATABASE_POOL_SIZE=10
DATABASE_IDLE_TIMEOUT=30000
DATABASE_CONNECTION_TIMEOUT=2000

# Security
MIGRATION_ENCRYPTION_ENABLED=true
MIGRATION_AUDIT_LOGGING=true
```

#### Performance Tuning Template
```javascript
// performance-config.js
export const performanceConfig = {
  batchSizes: {
    customers: 1000,
    suppliers: 500,
    products: 2000,
    inventory: 1000,
    priceLists: 100,
    priceListItems: 5000,
    uploadHistory: 1000
  },
  
  parallelization: {
    enabled: true,
    maxConcurrent: 3,
    independentTables: ['customers', 'suppliers'],
    dependentTables: ['products', 'inventory', 'priceLists']
  },
  
  optimization: {
    connectionPoolSize: 10,
    queryTimeout: 30000,
    indexCreation: 'after_migration',
    statisticsUpdate: 'after_migration'
  }
};
```

### Appendix C: Troubleshooting Quick Reference

#### Common Error Codes
- **ERR_001**: Database connection failure
- **ERR_002**: Schema validation failure
- **ERR_003**: Data validation failure
- **ERR_004**: Foreign key constraint violation
- **ERR_005**: Duplicate key violation
- **ERR_006**: Migration timeout
- **ERR_007**: Memory exhaustion
- **ERR_008**: Disk space insufficient
- **ERR_009**: Data corruption detected
- **ERR_010**: Rollback failure

#### Quick Fixes
```bash
# Connection issues
npm run migration:reconnect

# Memory issues
npm run migration:reduce-memory

# Timeout issues
npm run migration:extend-timeout

# Validation failures
npm run migration:skip-validation --unsafe

# Performance issues
npm run migration:optimize-performance
```

---

**Manual Version:** 1.0.0  
**Last Updated:** 2025-01-19  
**Next Review:** After production deployment  
**Maintained By:** Data Migration Agent  
**Approved By:** [Pending stakeholder approval]

---

*This manual is designed for production use. Always test procedures in a staging environment before executing in production. For questions or issues not covered in this manual, contact the migration team.*