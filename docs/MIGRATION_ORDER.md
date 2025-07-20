# Database Migration Order

This document defines the correct order for running database migrations in the NXT NEW DAY system.

## Migration Execution Commands

```bash
# Run all migrations
npm run db:migrate

# Validate schema after migrations
npm run db:validate

# Rollback migrations (specify number of steps)
npm run db:rollback      # Rollback last migration
npm run db:rollback 3    # Rollback last 3 migrations
```

## Migration Files and Order

The migrations must be executed in the following order to ensure proper schema creation and foreign key constraints:

### 1. Base Schema Migration (0001_unified_supplier_module.sql)
**Purpose**: Creates core tables and relationships
**Tables Created**:
- users
- roles
- permissions
- user_roles
- role_permissions
- customers
- customer_segments
- suppliers
- supplier_contacts
- supplier_categories
- supplier_performance_metrics
- products
- price_lists
- price_list_items
- price_approvals
- inventory
- inventory_movements
- stock_levels
- upload_history
- audit_logs
- notifications
- system_settings

### 2. Customer Purchase History (0002_customer_purchase_history.sql)
**Purpose**: Adds customer analytics tables
**Tables Created**:
- customer_purchase_history
**Dependencies**: Requires customers table from migration 0001

### 3. Performance Optimization Indexes (0003_performance_optimization_indexes.sql)
**Purpose**: Adds performance indexes for query optimization
**Indexes Created**:
- idx_customers_email
- idx_customers_phone
- idx_suppliers_code
- idx_purchase_orders_customer_id
- idx_purchase_orders_status
- idx_invoices_customer_id
- idx_invoices_status
- idx_inventory_product_id
- idx_price_list_items_product_id
**Dependencies**: Requires all tables from previous migrations

### 4. Supplier Purchase Orders (0003_supplier_purchase_orders.sql)
**Purpose**: Adds supplier purchase order management
**Tables Created**:
- purchase_orders
- purchase_order_items
- supplier_purchase_orders
- supplier_purchase_order_items
**Dependencies**: Requires suppliers, customers, and products tables from migration 0001

### 5. Invoicing System (0004_invoicing_system.sql)
**Purpose**: Adds invoicing capabilities
**Tables Created**:
- invoices
- invoice_items
**Dependencies**: Requires customers and purchase_orders tables

## Important Notes

1. **Order Matters**: These migrations must be run in sequence. Running them out of order will cause foreign key constraint violations.

2. **Drizzle Migration Table**: The system uses Drizzle ORM which tracks applied migrations in the `drizzle_migrations` table.

3. **Validation**: Always run `npm run db:validate` after migrations to ensure all expected tables and indexes are present.

4. **Rollback Limitations**: The rollback script removes migration tracking but does NOT reverse schema changes. Manual DROP statements are required to remove tables.

## Migration Best Practices

1. **Before Running Migrations**:
   - Backup the database
   - Review migration files
   - Test in development environment

2. **During Migration**:
   - Monitor for errors
   - Check foreign key constraints
   - Verify data integrity

3. **After Migration**:
   - Run schema validation
   - Test critical features
   - Monitor application logs

## Troubleshooting

### Common Issues

1. **Foreign Key Constraint Violations**
   - Ensure migrations are run in correct order
   - Check that referenced tables exist

2. **Missing Tables**
   - Run `npm run db:validate` to identify missing tables
   - Re-run migrations if needed

3. **Index Creation Failures**
   - Verify base tables exist
   - Check for duplicate index names

### Recovery Procedures

```bash
# If migrations fail:
1. Check error logs
2. Fix the issue
3. Rollback if needed: npm run db:rollback
4. Re-run migrations: npm run db:migrate

# For complete reset (DEVELOPMENT ONLY):
1. Drop all tables manually
2. Remove drizzle_migrations table
3. Run fresh migrations: npm run db:migrate
```

## Migration Status Check

To check current migration status:

```bash
# View applied migrations
npm run db:status

# Validate schema completeness
npm run db:validate
```