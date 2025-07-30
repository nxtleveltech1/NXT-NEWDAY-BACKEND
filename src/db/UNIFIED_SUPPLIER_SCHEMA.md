# Unified Supplier Module Database Schema

## Overview
This document describes the database schema for the unified supplier module, which consolidates vendor and supplier functionality into a single, comprehensive system with enhanced price list management and upload processing capabilities.

## Schema Changes Summary

### 1. Enhanced Suppliers Table (Vendor Consolidation)

The `suppliers` table has been enhanced to consolidate all vendor functionality:

```sql
-- Core identification
id                    UUID PRIMARY KEY
supplier_code         VARCHAR(50) UNIQUE NOT NULL
company_name          VARCHAR(255) NOT NULL
email                 VARCHAR(255) NOT NULL
phone                 VARCHAR(50)
website               VARCHAR(255)

-- Address and contact information
address               JSONB DEFAULT '{}' NOT NULL
contact_details       JSONB DEFAULT '{}' NOT NULL

-- Financial and business terms
payment_terms         JSONB DEFAULT '{}' NOT NULL
credit_limit          DECIMAL(12,2)
tax_id                VARCHAR(50)

-- Business classification
supplier_type         VARCHAR(50) DEFAULT 'vendor'
                      -- Constraint: vendor, manufacturer, distributor, service_provider
industry              VARCHAR(100)

-- Performance tracking
performance_rating    DECIMAL(3,2) DEFAULT 0
lead_time_days        INTEGER DEFAULT 0

-- Vendor consolidation
vendor_metadata       JSONB DEFAULT '{}' NOT NULL  -- Legacy vendor data storage

-- Approval workflow
is_active             BOOLEAN DEFAULT true NOT NULL
is_approved           BOOLEAN DEFAULT false NOT NULL
approved_at           TIMESTAMP WITH TIME ZONE
approved_by           UUID

-- Audit trail
created_at            TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
updated_at            TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
```

**Indexes:**
- `supplier_code_idx` (supplier_code)
- `supplier_company_idx` (company_name)
- `supplier_email_idx` (email)
- `supplier_active_idx` (is_active)
- `supplier_type_idx` (supplier_type)
- `supplier_industry_idx` (industry)
- `supplier_performance_idx` (performance_rating)
- `supplier_approved_idx` (is_approved)

### 2. Enhanced Price Lists Table (Version Control & Validation)

The `price_lists` table supports version control and comprehensive validation:

```sql
-- Core identification
id                    UUID PRIMARY KEY
supplier_id           UUID REFERENCES suppliers(id) NOT NULL
name                  VARCHAR(255) NOT NULL

-- Date management
effective_date        DATE NOT NULL
expiry_date           DATE

-- Status and lifecycle
status                VARCHAR(50) DEFAULT 'draft'
                      -- Values: draft, active, expired, archived

-- Version control
version               VARCHAR(50) DEFAULT '1.0'
parent_price_list_id  UUID REFERENCES price_lists(id)

-- Upload metadata
upload_format         VARCHAR(50)  -- CSV, Excel, PDF, XML, JSON
original_file_path    TEXT
original_file_name    VARCHAR(255)

-- Validation and approval
validation_status     VARCHAR(50) DEFAULT 'pending'
                      -- Constraint: pending, validated, failed
validation_errors     JSONB DEFAULT '[]'
approved_by           UUID
approved_at           TIMESTAMP WITH TIME ZONE

-- Analytics
item_count           INTEGER DEFAULT 0
currencies_supported JSONB DEFAULT '["USD"]'

-- Audit trail
created_at           TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
updated_at           TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
```

**Indexes:**
- `price_list_supplier_idx` (supplier_id)
- `price_list_status_idx` (status)
- `price_list_effective_idx` (effective_date)
- `price_list_supplier_status_idx` (supplier_id, status)
- `price_list_version_idx` (version)
- `price_list_validation_idx` (validation_status)
- `price_list_parent_idx` (parent_price_list_id)

### 3. Price List Items Table (Tiered Pricing Support)

Supports multi-currency and quantity-based tiered pricing:

```sql
-- Core identification
id                UUID PRIMARY KEY
price_list_id     UUID REFERENCES price_lists(id) ON DELETE CASCADE NOT NULL
sku               VARCHAR(100) NOT NULL
description       TEXT

-- Pricing information
unit_price        DECIMAL(15,5) NOT NULL
currency          VARCHAR(3) DEFAULT 'USD'
                  -- Constraint: USD, EUR, GBP, ZAR
min_quantity      INTEGER DEFAULT 1
discount_percent  DECIMAL(5,2) DEFAULT 0

-- Tiered pricing (JSON array)
tier_pricing      JSONB DEFAULT '[]'
                  -- Format: [{"minQty": 10, "price": 9.50, "discount": 5.0}]
```

**Indexes:**
- `price_item_list_idx` (price_list_id)
- `price_item_sku_idx` (sku)
- `price_item_list_sku_idx` (price_list_id, sku)
- `price_item_min_qty_idx` (min_quantity)

<<<<<<< HEAD
### 4. Upload History Table (New)
=======
### 4. Supplier Inventory Table (New)

Tracks supplier inventory levels, lead times, and availability for efficient procurement:

```sql
-- Core identification
id                       UUID PRIMARY KEY
supplier_id              UUID REFERENCES suppliers(id) ON DELETE CASCADE NOT NULL
product_id               UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL
sku                      VARCHAR(100) NOT NULL

-- Stock levels at supplier
quantity_available       INTEGER DEFAULT 0 NOT NULL
quantity_allocated       INTEGER DEFAULT 0 NOT NULL
quantity_on_order        INTEGER DEFAULT 0 NOT NULL
quantity_in_production   INTEGER DEFAULT 0 NOT NULL

-- Lead time information
standard_lead_time_days  INTEGER DEFAULT 0 NOT NULL
express_lead_time_days   INTEGER
current_lead_time_days   INTEGER DEFAULT 0 NOT NULL
lead_time_variance_days  INTEGER DEFAULT 0

-- Availability and scheduling
next_available_date      TIMESTAMP WITH TIME ZONE
production_schedule      JSONB DEFAULT '[]'
                         -- Format: [{"date": "2025-08-01", "quantity": 1000}]
blackout_dates           JSONB DEFAULT '[]'
                         -- Format: [{"start": "2025-12-20", "end": "2025-01-05"}]

-- Minimum order quantities
min_order_quantity       INTEGER DEFAULT 1 NOT NULL
order_increment          INTEGER DEFAULT 1 NOT NULL
max_order_quantity       INTEGER

-- Pricing tiers
default_unit_price       DECIMAL(10,2)
volume_pricing           JSONB DEFAULT '[]'
                         -- Format: [{"minQty": 100, "price": 9.50, "discount": 5.0}]
currency                 VARCHAR(3) DEFAULT 'USD' NOT NULL
price_list_item_id       UUID REFERENCES price_list_items(id)

-- Supplier performance metrics
on_time_delivery_rate    DECIMAL(5,2) DEFAULT 100.00
quality_rating           DECIMAL(5,2) DEFAULT 100.00
fulfillment_rate         DECIMAL(5,2) DEFAULT 100.00
last_delivery_date       TIMESTAMP WITH TIME ZONE
last_order_date          TIMESTAMP WITH TIME ZONE

-- Warehouse preferences
preferred_warehouse_id   UUID REFERENCES warehouses(id)
alternate_warehouse_ids  JSONB DEFAULT '[]'

-- Product specifications
product_specifications   JSONB DEFAULT '{}'
packaging_info           JSONB DEFAULT '{}'
                         -- Format: {"unitsPerCase": 12, "caseDimensions": {...}, "weight": 25}
handling_requirements    JSONB DEFAULT '{}'
                         -- Format: {"temperature": "cool", "fragile": true, "hazmat": false}

-- Status and lifecycle
status                   VARCHAR(50) DEFAULT 'active' NOT NULL
                         -- Constraint: active, discontinued, seasonal, temporarily_unavailable
availability_status      VARCHAR(50) DEFAULT 'in_stock' NOT NULL
                         -- Constraint: in_stock, low_stock, out_of_stock, made_to_order
discontinued_date        TIMESTAMP WITH TIME ZONE
seasonal_availability    JSONB DEFAULT '{}'
                         -- Format: {"startMonth": 3, "endMonth": 10}

-- Integration and sync
external_inventory_id    VARCHAR(100)
last_sync_date           TIMESTAMP WITH TIME ZONE
sync_status              VARCHAR(50) DEFAULT 'pending'
                         -- Constraint: pending, synced, failed, disabled
sync_errors              JSONB DEFAULT '[]'

-- Notes and metadata
notes                    TEXT
internal_notes           TEXT
metadata                 JSONB DEFAULT '{}' NOT NULL

-- Audit trail
created_by               UUID
updated_by               UUID
created_at               TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
updated_at               TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL

-- Composite unique constraint
CONSTRAINT supplier_inventory_supplier_product_unique UNIQUE (supplier_id, product_id)
```

**Indexes:**
- `supplier_inv_supplier_idx` (supplier_id)
- `supplier_inv_product_idx` (product_id)
- `supplier_inv_sku_idx` (sku)
- `supplier_inv_status_idx` (status)
- `supplier_inv_availability_idx` (availability_status)
- `supplier_inv_supplier_product_idx` (supplier_id, product_id)
- `supplier_inv_supplier_sku_idx` (supplier_id, sku)
- `supplier_inv_next_available_idx` (next_available_date)
- `supplier_inv_lead_time_idx` (current_lead_time_days)
- `supplier_inv_warehouse_idx` (preferred_warehouse_id)
- `supplier_inv_sync_status_idx` (sync_status)
- `supplier_inv_external_id_idx` (external_inventory_id)

### 5. Upload History Table (New)
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580

Tracks all price list upload operations for auditing and error handling:

```sql
-- Core identification
id              UUID PRIMARY KEY
supplier_id     UUID REFERENCES suppliers(id) NOT NULL
price_list_id   UUID REFERENCES price_lists(id)

-- File information
file_name       VARCHAR(255) NOT NULL
file_type       VARCHAR(50) NOT NULL
file_size       INTEGER NOT NULL

-- Processing status
status          VARCHAR(50) NOT NULL
                -- Constraint: processing, completed, failed, queued, cancelled

-- Processing results
item_count      INTEGER DEFAULT 0
success_count   INTEGER DEFAULT 0
error_count     INTEGER DEFAULT 0
errors          JSONB DEFAULT '[]'
warnings        JSONB DEFAULT '[]'

-- Timing information
upload_date     TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
completed_at    TIMESTAMP WITH TIME ZONE
failed_at       TIMESTAMP WITH TIME ZONE

-- Actor and metadata
uploaded_by     UUID NOT NULL
metadata        JSONB DEFAULT '{}'

-- Audit trail
created_at      TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
updated_at      TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
```

**Indexes:**
- `upload_history_supplier_idx` (supplier_id)
- `upload_history_status_idx` (status)
- `upload_history_upload_date_idx` (upload_date)
- `upload_history_uploaded_by_idx` (uploaded_by)

## Key Features Implemented

### 1. Vendor Consolidation
- All vendor-specific fields moved to suppliers table
- `vendor_metadata` JSONB field preserves legacy data
- `supplier_type` differentiates between vendor types
- Performance tracking with ratings and lead times

### 2. Multi-Currency Support
- Price list items support USD, EUR, GBP, ZAR
- Currency constraints enforced at database level
- Price lists track supported currencies

### 3. Tiered Pricing
- JSON-based tier pricing in `price_list_items.tier_pricing`
- Minimum quantity support
- Flexible discount structure

### 4. Version Control
- Price lists support versioning with `version` field
- Parent-child relationships via `parent_price_list_id`
- Full audit trail with created/updated timestamps

### 5. Upload Processing
- Complete upload history tracking
- Error and warning capture
- Status workflow: queued → processing → completed/failed
- File metadata preservation

### 6. Validation Workflow
- Price lists have validation status
- Validation errors stored in JSON format
- Approval workflow with approval tracking

<<<<<<< HEAD
=======
### 7. Supplier Inventory Management
- Real-time inventory tracking at supplier locations
- Lead time management with standard and express options
- Production schedule and blackout dates support
- Volume-based pricing integration
- Supplier performance metrics (on-time delivery, quality, fulfillment)
- Warehouse preference management
- Automatic availability status calculation
- External system integration support

>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
## Migration Instructions

### 1. Apply Migration
```bash
# Run the unified supplier module migration
node src/db/migrations/migration-helper.js migrate
```

### 2. Verify Schema
```bash
# Verify all tables and fields are properly created
node src/db/migrations/migration-helper.js verify
```

### 3. Check Status
```bash
# Check migration status
node src/db/migrations/migration-helper.js status
```

## Business Rules & Constraints

### Supplier Constraints
- `supplier_type` must be one of: vendor, manufacturer, distributor, service_provider
- `supplier_code` must be unique
- Email format validation at application level

### Price List Constraints
- `validation_status` must be one of: pending, validated, failed
- `status` must be one of: draft, active, expired, archived
- Only one active price list per supplier at any given time (business rule)

### Currency Constraints
- Supported currencies: USD, EUR, GBP, ZAR
- Default currency is USD
- Currency validation enforced at database level

### Upload History Constraints
- `status` must be one of: processing, completed, failed, queued, cancelled
- File size must be positive integer
- Upload date cannot be in the future (business rule)

<<<<<<< HEAD
=======
### Supplier Inventory Constraints
- `status` must be one of: active, discontinued, seasonal, temporarily_unavailable
- `availability_status` must be one of: in_stock, low_stock, out_of_stock, made_to_order
- `sync_status` must be one of: pending, synced, failed, disabled
- All quantity fields must be non-negative
- `min_order_quantity` and `order_increment` must be greater than 0
- One supplier-product combination must be unique (enforced by composite constraint)
- Availability status automatically calculated based on effective quantity

>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
## Performance Considerations

### Indexing Strategy
- Composite indexes on frequently queried combinations
- Supplier-status combinations for fast filtering
- Date-based indexes for time-range queries

### Query Optimization
- Use supplier-specific indexes for price list queries
- Leverage status indexes for upload monitoring
- Consider partitioning for large upload history tables

## Integration Points

### Analytics Integration
- Daily aggregates can be built from upload history
- Supplier performance metrics from price list data
- Version control enables price trend analysis

### External System Integration
- `vendor_metadata` field preserves legacy system data
- Upload history enables integration monitoring
- Flexible JSON fields support varying integration requirements

## Data Migration from Legacy Systems

### Vendor → Supplier Migration
```sql
-- Example migration from old vendor table
INSERT INTO suppliers (
  supplier_code, company_name, email, supplier_type, 
  vendor_metadata, created_at
)
SELECT 
  vendor_code, company_name, email, 'vendor',
  jsonb_build_object('legacy_vendor_id', id, 'notes', notes),
  created_at
FROM legacy_vendors;
```

### Price List Data Migration
- Preserve original file paths and formats
- Set validation_status to 'validated' for existing data
- Create version 1.0 for all migrated price lists

## Monitoring and Maintenance

### Regular Maintenance Tasks
1. Archive old upload history records (> 1 year)
2. Clean up expired price lists
3. Monitor supplier approval workflow
4. Validate data integrity constraints

### Performance Monitoring
1. Track upload processing times
2. Monitor price list query performance
3. Analyze supplier performance metrics
4. Review validation error patterns

This unified supplier module provides a robust foundation for comprehensive supplier management with enhanced price list processing capabilities.