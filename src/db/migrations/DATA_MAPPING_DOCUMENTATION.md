# NXT NEW DAY - Data Migration Mapping Documentation

## Overview

This document provides comprehensive field-by-field mapping documentation for the NXT NEW DAY data migration from legacy systems to the new unified database schema. It serves as the authoritative reference for understanding how legacy data transforms into the new system structure.

**Version:** 1.0.0  
**Last Updated:** 2025-01-19  
**Migration Agent:** Data Migration Agent  

---

## Migration Scope

### Systems Involved
- **Source System:** Legacy Database (PostgreSQL/MySQL)
- **Target System:** NXT NEW DAY (PostgreSQL with Drizzle ORM)
- **Backup System:** Neon PostgreSQL Backup Database

### Data Volume Estimates
- **Customers:** 10,000 - 100,000 records
- **Suppliers:** 5,000 - 50,000 records (including legacy vendors)
- **Products:** 20,000 - 200,000 records
- **Inventory:** 30,000 - 300,000 records
- **Price Lists:** 1,000 - 10,000 records
- **Price List Items:** 100,000 - 1,000,000 records

---

## Customer Data Mapping

### Table Mapping: `legacy_customers` → `customers`

| Legacy Field | New Field | Data Type | Transformation | Notes |
|--------------|-----------|-----------|----------------|-------|
| `id` | `id` | UUID | Direct mapping | Preserved if UUID, generated if not |
| `customer_code` | `customerCode` | varchar(50) | Direct mapping | **Required field** |
| `company_name` | `companyName` | varchar(255) | Direct mapping | **Required field** |
| `email` | `email` | varchar(255) | Format validation | **Required field**, validated for format |
| `phone` | `phone` | varchar(50) | Format normalization | Optional, normalized to international format |
| `address_line_1` | `address.line1` | JSONB | Address consolidation | Moved to address JSONB object |
| `address_line_2` | `address.line2` | JSONB | Address consolidation | Moved to address JSONB object |
| `city` | `address.city` | JSONB | Address consolidation | Moved to address JSONB object |
| `state` | `address.state` | JSONB | Address consolidation | Moved to address JSONB object |
| `country` | `address.country` | JSONB | Address consolidation | Moved to address JSONB object |
| `postal_code` | `address.postalCode` | JSONB | Address consolidation | Moved to address JSONB object |
| `contact_person` | `metadata.contactPerson` | JSONB | Metadata consolidation | Moved to metadata object |
| `customer_type` | `metadata.legacy.customerType` | JSONB | Legacy preservation | Preserved in legacy metadata |
| `credit_limit` | `metadata.legacy.creditLimit` | JSONB | Legacy preservation | Preserved in legacy metadata |
| `payment_terms` | `metadata.legacy.paymentTerms` | JSONB | Legacy preservation | Preserved in legacy metadata |
| `tax_id` | `metadata.legacy.taxId` | JSONB | Legacy preservation | Preserved in legacy metadata |
| `industry` | `metadata.legacy.industry` | JSONB | Legacy preservation | Preserved in legacy metadata |
| `customer_status` | `metadata.legacy.status` | JSONB | Legacy preservation | Preserved in legacy metadata |
| N/A | `purchaseHistory` | JSONB | New field | Initialized as empty array |
| N/A | `metadata.migrationDate` | JSONB | Migration tracking | Set to migration timestamp |
| `created_at` | `createdAt` | timestamp | Direct mapping | Preserved from legacy |
| `updated_at` | `updatedAt` | timestamp | Direct mapping | Preserved from legacy |

### Address Structure Example
```json
{
  "line1": "123 Main Street",
  "line2": "Suite 100",
  "city": "New York",
  "state": "NY",
  "country": "US",
  "postalCode": "10001"
}
```

### Metadata Structure Example
```json
{
  "legacy": {
    "customerType": "enterprise",
    "creditLimit": 50000.00,
    "paymentTerms": "NET30",
    "taxId": "12-3456789",
    "industry": "technology",
    "status": "active"
  },
  "migrationDate": "2025-01-19T10:30:00.000Z",
  "contactPerson": "John Smith"
}
```

---

## Supplier Data Mapping

### Table Mapping: `legacy_suppliers` + `legacy_vendors` → `suppliers`

This migration consolidates both legacy suppliers and vendors into a unified suppliers table.

#### From `legacy_suppliers`:

| Legacy Field | New Field | Data Type | Transformation | Notes |
|--------------|-----------|-----------|----------------|-------|
| `id` | `id` | UUID | Direct mapping | Preserved if UUID |
| `supplier_code` | `supplierCode` | varchar(50) | Direct mapping | **Required field** |
| `company_name` | `companyName` | varchar(255) | Direct mapping | **Required field** |
| `email` | `email` | varchar(255) | Format validation | **Required field** |
| `phone` | `phone` | varchar(50) | Format normalization | Optional |
| `website` | `website` | varchar(255) | Direct mapping | Optional |
| `address_data` | `address` | JSONB | Direct mapping | Preserved as JSONB |
| `contact_details` | `contactDetails` | JSONB | Direct mapping | Preserved as JSONB |
| `payment_terms` | `paymentTerms` | JSONB | Direct mapping | Preserved as JSONB |
| `credit_limit` | `creditLimit` | decimal(12,2) | Direct mapping | Optional |
| `tax_id` | `taxId` | varchar(50) | Direct mapping | Optional |
| `supplier_type` | `supplierType` | varchar(50) | Direct mapping | Default: 'supplier' |
| `industry` | `industry` | varchar(100) | Direct mapping | Optional |
| `performance_rating` | `performanceRating` | decimal(3,2) | Direct mapping | Default: 0 |
| `lead_time_days` | `leadTimeDays` | integer | Direct mapping | Default: 0 |
| `is_active` | `isActive` | boolean | Direct mapping | Default: true |
| `is_approved` | `isApproved` | boolean | Direct mapping | Default: false |
| `approved_at` | `approvedAt` | timestamp | Direct mapping | Optional |
| `approved_by` | `approvedBy` | UUID | Direct mapping | Optional |
| N/A | `vendorMetadata.legacy.originalType` | JSONB | Migration tracking | Set to 'supplier' |
| N/A | `vendorMetadata.migrationDate` | JSONB | Migration tracking | Set to migration timestamp |
| `created_at` | `createdAt` | timestamp | Direct mapping | Preserved |
| `updated_at` | `updatedAt` | timestamp | Direct mapping | Preserved |

#### From `legacy_vendors`:

| Legacy Field | New Field | Data Type | Transformation | Notes |
|--------------|-----------|-----------|----------------|-------|
| `id` | `id` | UUID | Direct mapping | Preserved if UUID |
| `vendor_code` | `supplierCode` | varchar(50) | Field rename | **Required field** |
| `company_name` | `companyName` | varchar(255) | Direct mapping | **Required field** |
| `email` | `email` | varchar(255) | Format validation | **Required field** |
| `phone` | `phone` | varchar(50) | Format normalization | Optional |
| `website` | `website` | varchar(255) | Direct mapping | Optional |
| `address_data` | `address` | JSONB | Direct mapping | Preserved as JSONB |
| `contact_details` | `contactDetails` | JSONB | Direct mapping | Preserved as JSONB |
| `payment_terms` | `paymentTerms` | JSONB | Direct mapping | Preserved as JSONB |
| `credit_limit` | `creditLimit` | decimal(12,2) | Direct mapping | Optional |
| `tax_id` | `taxId` | varchar(50) | Direct mapping | Optional |
| `vendor_type` | `supplierType` | varchar(50) | Set to 'vendor' | Marked as vendor type |
| `industry` | `industry` | varchar(100) | Direct mapping | Optional |
| `performance_rating` | `performanceRating` | decimal(3,2) | Direct mapping | Default: 0 |
| `lead_time_days` | `leadTimeDays` | integer | Direct mapping | Default: 0 |
| `is_active` | `isActive` | boolean | Direct mapping | Default: true |
| N/A | `isApproved` | boolean | Set to true | Assume legacy vendors are approved |
| `created_at` | `approvedAt` | timestamp | Copy from created_at | Use creation date as approval |
| `certification_data` | `vendorMetadata.legacy.certificationData` | JSONB | Legacy preservation | Vendor-specific data |
| `contract_details` | `vendorMetadata.legacy.contractDetails` | JSONB | Legacy preservation | Vendor-specific data |
| N/A | `vendorMetadata.legacy.originalType` | JSONB | Migration tracking | Set to 'vendor' |
| N/A | `vendorMetadata.migrationDate` | JSONB | Migration tracking | Set to migration timestamp |
| `created_at` | `createdAt` | timestamp | Direct mapping | Preserved |
| `updated_at` | `updatedAt` | timestamp | Direct mapping | Preserved |

### Vendor Metadata Structure Example
```json
{
  "legacy": {
    "originalType": "vendor",
    "vendorType": "manufacturer",
    "certificationData": {
      "iso9001": true,
      "iso14001": false,
      "certificationDate": "2023-01-15"
    },
    "contractDetails": {
      "contractNumber": "VND-2023-001",
      "startDate": "2023-01-01",
      "endDate": "2025-12-31",
      "terms": "Standard vendor agreement"
    }
  },
  "migrationDate": "2025-01-19T10:30:00.000Z"
}
```

---

## Product Data Mapping

### Table Mapping: `legacy_products` → `products`

| Legacy Field | New Field | Data Type | Transformation | Notes |
|--------------|-----------|-----------|----------------|-------|
| `id` | `id` | UUID | Direct mapping | Preserved if UUID |
| `sku` | `sku` | varchar(100) | Direct mapping | **Required field**, unique |
| `name` or `product_name` | `name` | varchar(255) | Field preference | **Required field** |
| `description` | `description` | text | Direct mapping | Optional |
| `category` | `category` | varchar(100) | Direct mapping | Optional |
| `unit_price` or `price` | `unitPrice` | decimal(10,2) | Field preference | Default: 0 |
| `cost_price` or `cost` | `costPrice` | decimal(10,2) | Field preference | Default: 0 |
| `supplier_id` | `supplierId` | UUID | Relationship mapping | Links to suppliers table |
| `supplier_code` | N/A | N/A | Lookup transformation | Used to find supplier_id |
| `is_active` | `isActive` | boolean | Direct mapping | Default: true |
| `product_code` | `metadata.legacy.productCode` | JSONB | Legacy preservation | Preserved in metadata |
| `barcode` | `metadata.legacy.barcode` | JSONB | Legacy preservation | Preserved in metadata |
| `weight` | `metadata.legacy.weight` | JSONB | Legacy preservation | Preserved in metadata |
| `dimensions` | `metadata.legacy.dimensions` | JSONB | Legacy preservation | Preserved in metadata |
| `tags` | `metadata.legacy.tags` | JSONB | Legacy preservation | Preserved in metadata |
| N/A | `metadata.migrationDate` | JSONB | Migration tracking | Set to migration timestamp |
| `created_at` | `createdAt` | timestamp | Direct mapping | Preserved |
| `updated_at` | `updatedAt` | timestamp | Direct mapping | Preserved |

### Product Metadata Structure Example
```json
{
  "legacy": {
    "productCode": "PROD-001",
    "barcode": "1234567890123",
    "weight": 2.5,
    "dimensions": {
      "length": 10,
      "width": 8,
      "height": 6,
      "unit": "cm"
    },
    "tags": ["electronics", "mobile", "smartphone"]
  },
  "migrationDate": "2025-01-19T10:30:00.000Z"
}
```

---

## Inventory Data Mapping

### Table Mapping: `legacy_inventory` → `inventory`

| Legacy Field | New Field | Data Type | Transformation | Notes |
|--------------|-----------|-----------|----------------|-------|
| N/A | `id` | serial | Auto-generated | New primary key |
| `product_sku` | N/A | N/A | Lookup transformation | Used to find productId |
| N/A | `productId` | UUID | Relationship mapping | Links to products table |
| `warehouse_id` | `warehouseId` | UUID | Direct mapping | **Required field** |
| `location_id` | `locationId` | UUID | Direct mapping | Optional |
| `quantity_on_hand` or `quantity` | `quantityOnHand` | integer | Field preference | Default: 0 |
| `quantity_available` | `quantityAvailable` | integer | Calculation | quantity_on_hand if null |
| `quantity_reserved` | `quantityReserved` | integer | Direct mapping | Default: 0 |
| `quantity_in_transit` | `quantityInTransit` | integer | Direct mapping | Default: 0 |
| `last_stock_check` | `lastStockCheck` | timestamp | Direct mapping | Optional |
| `last_movement` | `lastMovement` | timestamp | Direct mapping | Optional |
| `stock_status` | `stockStatus` | varchar(50) | Direct mapping | Default: 'in_stock' |
| `reorder_point` | `reorderPoint` | integer | Direct mapping | Default: 0 |
| `reorder_quantity` | `reorderQuantity` | integer | Direct mapping | Default: 0 |
| `max_stock_level` | `maxStockLevel` | integer | Direct mapping | Optional |
| `min_stock_level` | `minStockLevel` | integer | Direct mapping | Default: 0 |
| `average_cost` | `averageCost` | decimal(10,2) | Direct mapping | Optional |
| `last_purchase_cost` | `lastPurchaseCost` | decimal(10,2) | Direct mapping | Optional |
| N/A | `metadata.legacy.originalInventoryId` | JSONB | Migration tracking | Original ID reference |
| N/A | `metadata.legacy.productSku` | JSONB | Migration tracking | Original SKU reference |
| N/A | `metadata.migrationDate` | JSONB | Migration tracking | Set to migration timestamp |
| `created_at` | `createdAt` | timestamp | Direct mapping | Preserved |
| `updated_at` | `updatedAt` | timestamp | Direct mapping | Preserved |

### Inventory Metadata Structure Example
```json
{
  "legacy": {
    "originalInventoryId": "INV-12345",
    "productSku": "PROD-SKU-001"
  },
  "migrationDate": "2025-01-19T10:30:00.000Z"
}
```

---

## Price List Data Mapping

### Table Mapping: `legacy_price_lists` → `price_lists`

| Legacy Field | New Field | Data Type | Transformation | Notes |
|--------------|-----------|-----------|----------------|-------|
| `id` | `id` | UUID | Direct mapping | Preserved if UUID |
| `supplier_id` | `supplierId` | UUID | Relationship mapping | Links to suppliers table |
| `supplier_code` | N/A | N/A | Lookup transformation | Used to find supplierId |
| `name` or `price_list_name` | `name` | varchar(255) | Field preference | **Required field** |
| `effective_date` | `effectiveDate` | date | Direct mapping | **Required field** |
| `expiry_date` | `expiryDate` | date | Direct mapping | Optional |
| `status` | `status` | varchar(50) | Direct mapping | Default: 'draft' |
| `version` | `version` | varchar(50) | Direct mapping | Default: '1.0' |
| `parent_price_list_id` | `parentPriceListId` | UUID | Direct mapping | Optional |
| `upload_format` | `uploadFormat` | varchar(50) | Direct mapping | Optional |
| `original_file_path` | `originalFilePath` | text | Direct mapping | Optional |
| `original_file_name` | `originalFileName` | varchar(255) | Direct mapping | Optional |
| `validation_status` | `validationStatus` | varchar(50) | Direct mapping | Default: 'pending' |
| `validation_errors` | `validationErrors` | JSONB | Direct mapping | Default: [] |
| `approved_by` | `approvedBy` | UUID | Direct mapping | Optional |
| `approved_at` | `approvedAt` | timestamp | Direct mapping | Optional |
| `item_count` | `itemCount` | integer | Direct mapping | Default: 0 |
| `currencies_supported` | `currenciesSupported` | JSONB | Direct mapping | Default: ["USD"] |
| `created_at` | `createdAt` | timestamp | Direct mapping | Preserved |
| `updated_at` | `updatedAt` | timestamp | Direct mapping | Preserved |

---

## Price List Items Data Mapping

### Table Mapping: `legacy_price_list_items` → `price_list_items`

| Legacy Field | New Field | Data Type | Transformation | Notes |
|--------------|-----------|-----------|----------------|-------|
| `id` | `id` | UUID | Direct mapping | Preserved if UUID |
| `price_list_id` | `priceListId` | UUID | Relationship mapping | Links to price_lists table |
| `sku` | `sku` | varchar(100) | Direct mapping | **Required field** |
| `description` | `description` | text | Direct mapping | Optional |
| `unit_price` or `price` | `unitPrice` | decimal(15,5) | Field preference | **Required field** |
| `currency` | `currency` | varchar(3) | Direct mapping | Default: 'USD' |
| `min_quantity` | `minQuantity` | integer | Direct mapping | Default: 1 |
| `discount_percent` | `discountPercent` | decimal(5,2) | Direct mapping | Default: 0 |
| `tier_pricing` | `tierPricing` | JSONB | Direct mapping | Default: [] |

---

## Upload History Data Mapping

### Table Mapping: `legacy_upload_history` → `upload_history`

| Legacy Field | New Field | Data Type | Transformation | Notes |
|--------------|-----------|-----------|----------------|-------|
| `id` | `id` | UUID | Direct mapping | Preserved if UUID |
| `supplier_id` | `supplierId` | UUID | Relationship mapping | Links to suppliers table |
| `supplier_code` | N/A | N/A | Lookup transformation | Used to find supplierId |
| `file_name` | `fileName` | varchar(255) | Direct mapping | **Required field** |
| `file_type` | `fileType` | varchar(50) | Direct mapping | **Required field** |
| `file_size` | `fileSize` | integer | Direct mapping | **Required field** |
| `status` | `status` | varchar(50) | Direct mapping | **Required field** |
| `item_count` | `itemCount` | integer | Direct mapping | Default: 0 |
| `success_count` | `successCount` | integer | Direct mapping | Default: 0 |
| `error_count` | `errorCount` | integer | Direct mapping | Default: 0 |
| `errors` | `errors` | JSONB | Direct mapping | Default: [] |
| `warnings` | `warnings` | JSONB | Direct mapping | Default: [] |
| `upload_date` | `uploadDate` | timestamp | Direct mapping | **Required field** |
| `completed_at` | `completedAt` | timestamp | Direct mapping | Optional |
| `failed_at` | `failedAt` | timestamp | Direct mapping | Optional |
| `uploaded_by` | `uploadedBy` | UUID | Direct mapping | **Required field** |
| `price_list_id` | `priceListId` | UUID | Relationship mapping | Links to price_lists table |
| `metadata` | `metadata` | JSONB | Direct mapping | Default: {} |
| `created_at` | `createdAt` | timestamp | Direct mapping | Preserved |
| `updated_at` | `updatedAt` | timestamp | Direct mapping | Preserved |

---

## Data Transformation Rules

### General Transformation Rules

1. **UUID Preservation**: Legacy UUIDs are preserved when possible; new UUIDs generated for non-UUID primary keys
2. **Required Field Validation**: All required fields must have valid, non-null values
3. **Date Standardization**: All timestamps converted to UTC timezone format
4. **Text Normalization**: String fields trimmed and normalized for consistent formatting
5. **Boolean Standardization**: Various boolean representations (0/1, true/false, Y/N) normalized to true/false
6. **Decimal Precision**: Financial values standardized to appropriate decimal precision
7. **JSON Structure**: Complex legacy data preserved in JSONB metadata fields

### Format Validation Rules

#### Email Validation
- Pattern: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- Required for customers and suppliers
- Invalid emails logged as validation errors

#### Phone Number Normalization
- International format preferred: `+1-555-123-4567`
- Various input formats accepted and normalized
- Invalid formats preserved but flagged

#### Currency Codes
- ISO 4217 three-letter codes (USD, EUR, GBP, etc.)
- Default to USD if not specified
- Invalid codes logged as warnings

### Relationship Resolution

#### Supplier-Product Relationships
1. Use `supplier_id` if available in legacy products
2. Fall back to `supplier_code` lookup in suppliers table
3. Log orphaned products (no matching supplier) as warnings
4. Set `supplierId` to null for orphaned products

#### Product-Inventory Relationships
1. Use `product_id` if available in legacy inventory
2. Fall back to `product_sku` lookup in products table
3. Skip inventory records with no matching product
4. Log skipped records as warnings

#### Price List Relationships
1. Ensure `supplierId` exists in suppliers table
2. Validate `parentPriceListId` references if specified
3. Ensure price list items reference valid price lists

---

## Error Handling and Data Quality

### Data Quality Issues

#### Common Issues and Resolutions

1. **Missing Required Fields**
   - Action: Skip record and log error
   - Recovery: Manual data entry or source system correction

2. **Duplicate Unique Fields**
   - Action: Use first occurrence, log duplicates
   - Recovery: Deduplicate in source system

3. **Invalid Foreign Key References**
   - Action: Set to null or skip record
   - Recovery: Fix relationships in source system

4. **Invalid Data Formats**
   - Action: Apply format correction where possible
   - Recovery: Manual review and correction

5. **Constraint Violations**
   - Action: Skip record and log violation
   - Recovery: Adjust data to meet constraints

### Migration Validation Checkpoints

1. **Pre-Migration Validation**
   - Source data quality check
   - Required field validation
   - Relationship integrity check
   - Format validation

2. **During Migration**
   - Batch processing validation
   - Real-time error logging
   - Progress monitoring
   - Memory usage monitoring

3. **Post-Migration Validation**
   - Record count verification
   - Relationship integrity check
   - Data consistency validation
   - Business rule validation

---

## Performance Considerations

### Batch Processing Strategy

1. **Customers**: 1,000 records per batch
2. **Suppliers**: 500 records per batch (includes vendor consolidation)
3. **Products**: 2,000 records per batch
4. **Inventory**: 1,000 records per batch
5. **Price Lists**: 100 records per batch
6. **Price List Items**: 5,000 records per batch

### Indexing Strategy

#### Source Database Optimization
- Ensure indexes on frequently queried fields
- Add temporary indexes for migration queries if needed
- Monitor query performance during migration

#### Target Database Preparation
- Pre-create all necessary indexes
- Analyze table statistics after migration
- Rebuild indexes if performance degrades

### Memory Management

1. **Connection Pooling**: Limit concurrent connections
2. **Batch Size Control**: Adjust based on available memory
3. **Garbage Collection**: Force GC between large batches
4. **Temporary Storage**: Monitor disk space for temporary files

---

## Business Rules and Constraints

### Data Integrity Rules

1. **Customer Code Uniqueness**: Must be unique across all customers
2. **Supplier Code Uniqueness**: Must be unique across all suppliers (including legacy vendors)
3. **Product SKU Uniqueness**: Must be unique across all products
4. **Email Format Validation**: Must follow standard email format
5. **Price Validation**: Unit prices and cost prices must be non-negative
6. **Quantity Validation**: Inventory quantities must be non-negative
7. **Date Validation**: Effective dates must be before expiry dates

### Business Logic Rules

1. **Supplier Type Assignment**: Legacy vendors marked as type 'vendor', legacy suppliers as 'supplier'
2. **Approval Status**: Legacy vendors assumed approved, legacy suppliers inherit status
3. **Default Values**: Missing optional fields assigned sensible defaults
4. **Metadata Preservation**: All legacy-specific data preserved in metadata fields

---

## Migration Timeline and Dependencies

### Migration Order (Critical for Referential Integrity)

1. **Customers** (Independent)
2. **Suppliers** (Independent - includes vendor consolidation)
3. **Products** (Depends on: Suppliers)
4. **Inventory** (Depends on: Products)
5. **Price Lists** (Depends on: Suppliers)
6. **Price List Items** (Depends on: Price Lists)
7. **Upload History** (Depends on: Suppliers, Price Lists)

### Estimated Migration Times

| Entity | Small (1K) | Medium (10K) | Large (100K) |
|--------|------------|--------------|--------------|
| Customers | 2 minutes | 15 minutes | 2.5 hours |
| Suppliers | 3 minutes | 20 minutes | 3 hours |
| Products | 1.5 minutes | 12 minutes | 2 hours |
| Inventory | 4 minutes | 30 minutes | 5 hours |
| Price Lists | 1 minute | 8 minutes | 1.5 hours |
| Price List Items | 30 seconds | 5 minutes | 45 minutes |
| Upload History | 30 seconds | 3 minutes | 30 minutes |

---

## Rollback Considerations

### Rollback Strategy by Entity

1. **Full Rollback**: Restore complete database from backup
2. **Selective Rollback**: Remove specific entity data
3. **Incremental Rollback**: Remove data added after specific timestamp

### Rollback Data Preservation

- Original record IDs preserved in metadata
- Migration timestamps recorded for all records
- Legacy field mappings documented for reverse transformation
- Relationship dependencies tracked for safe rollback order

---

## Monitoring and Reporting

### Migration Metrics

1. **Record Counts**: Source vs. target record counts by entity
2. **Processing Rate**: Records processed per minute
3. **Error Rate**: Percentage of failed record transformations
4. **Data Quality Score**: Percentage of records passing validation
5. **Performance Metrics**: Memory usage, CPU utilization, I/O throughput

### Alert Thresholds

- **High Error Rate**: > 5% of records failing transformation
- **Low Performance**: < 50 records/second processing rate
- **Memory Issues**: > 80% memory utilization
- **Relationship Errors**: > 1% orphaned records

### Reporting Outputs

1. **Real-time Dashboard**: Live migration progress and metrics
2. **Detailed Logs**: Comprehensive error and warning logs
3. **Summary Reports**: High-level migration success metrics
4. **Data Quality Reports**: Detailed validation results
5. **Performance Reports**: Timing and resource utilization analysis

---

## Troubleshooting Guide

### Common Issues and Solutions

#### Issue: High Error Rate in Customer Migration
**Symptoms**: > 5% of customer records failing validation  
**Cause**: Missing required fields (customer_code, company_name, email)  
**Solution**: 
1. Identify records with missing required fields
2. Set default values where appropriate
3. Skip invalid records and log for manual review
4. Update source data and re-run migration

#### Issue: Supplier-Product Relationship Failures
**Symptoms**: Products with null supplier_id after migration  
**Cause**: supplier_code in products table doesn't match any supplier  
**Solution**:
1. Review supplier code mappings
2. Create missing supplier records
3. Update product supplier references
4. Re-run product migration

#### Issue: Slow Migration Performance
**Symptoms**: Processing rate < 50 records/second  
**Cause**: Insufficient resources or inefficient queries  
**Solution**:
1. Increase batch size for large tables
2. Add temporary indexes on frequently queried fields
3. Increase memory allocation
4. Use parallel processing where possible

#### Issue: Memory Exhaustion
**Symptoms**: Out of memory errors during migration  
**Cause**: Large batch sizes or memory leaks  
**Solution**:
1. Reduce batch sizes
2. Force garbage collection between batches
3. Restart migration process
4. Increase available memory

---

## Validation Checklist

### Pre-Migration Checklist

- [ ] Source database connectivity verified
- [ ] Target database schema deployed
- [ ] Backup database configured
- [ ] Migration scripts tested on sample data
- [ ] Performance benchmarks established
- [ ] Error handling procedures tested
- [ ] Rollback procedures validated

### During Migration Checklist

- [ ] Real-time monitoring active
- [ ] Error rates within acceptable limits
- [ ] Processing rates meeting expectations
- [ ] Memory usage stable
- [ ] Relationship integrity maintained
- [ ] Progress checkpoints functioning

### Post-Migration Checklist

- [ ] Record counts verified (source vs. target)
- [ ] Data integrity validation passed
- [ ] Relationship constraints verified
- [ ] Business rule validation passed
- [ ] Performance benchmarks met
- [ ] Migration report generated
- [ ] Stakeholder approval obtained

---

## Appendices

### Appendix A: Sample Data Transformations

#### Customer Address Transformation
```sql
-- Legacy Format
address_line_1: "123 Main Street"
address_line_2: "Suite 100"
city: "New York"
state: "NY"
country: "US"
postal_code: "10001"

-- New Format
address: {
  "line1": "123 Main Street",
  "line2": "Suite 100", 
  "city": "New York",
  "state": "NY",
  "country": "US",
  "postalCode": "10001"
}
```

#### Vendor to Supplier Transformation
```sql
-- Legacy Vendor
vendor_code: "VND001"
vendor_type: "manufacturer"
certification_data: {...}

-- New Supplier
supplierCode: "VND001"
supplierType: "vendor"
vendorMetadata: {
  "legacy": {
    "originalType": "vendor",
    "vendorType": "manufacturer",
    "certificationData": {...}
  }
}
```

### Appendix B: Database Schema Changes

#### Key Schema Differences

1. **Unified Suppliers**: Consolidates vendors and suppliers
2. **JSONB Metadata**: Flexible storage for legacy and new data
3. **Enhanced Inventory**: Real-time tracking capabilities
4. **Improved Indexing**: Optimized for query performance
5. **Audit Trails**: Created/updated timestamps on all tables

### Appendix C: Migration Scripts Reference

- `data-migration-suite.js`: Main migration orchestration
- `data-validation-suite.js`: Data quality validation
- `rollback-suite.js`: Rollback procedures
- `migration-dashboard.js`: Real-time monitoring
- `migration-test-suite.js`: Testing framework

---

**Document Version:** 1.0.0  
**Last Updated:** 2025-01-19  
**Next Review:** Before production deployment  
**Maintained By:** Data Migration Agent  
**Approved By:** [Pending stakeholder approval]