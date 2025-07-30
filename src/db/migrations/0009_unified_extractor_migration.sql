-- Migration: 0009_unified_extractor_migration.sql
-- Description: Add tables and columns to support migrated unified-extractor functionality
-- Date: 2025-07-30
-- Migrated from unified-extractor MySQL to PostgreSQL

-- ==================== IMPORT HISTORY TABLE ====================
CREATE TABLE IF NOT EXISTS import_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    records_total INTEGER NOT NULL DEFAULT 0,
    records_imported INTEGER NOT NULL DEFAULT 0,
    records_skipped INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    mapping JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_history_table_name ON import_history(table_name);
CREATE INDEX IF NOT EXISTS idx_import_history_status ON import_history(status);
CREATE INDEX IF NOT EXISTS idx_import_history_created_at ON import_history(created_at);

-- ==================== EXTRACTION JOBS TABLE ====================
CREATE TABLE IF NOT EXISTS extraction_jobs (
    id VARCHAR(100) PRIMARY KEY,
    type VARCHAR(50) NOT NULL, -- 'suppliers', 'inventory', 'purchase_orders'
    source VARCHAR(100) NOT NULL, -- source type
    config JSONB NOT NULL,
    filters JSONB DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    result JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_type ON extraction_jobs(type);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status ON extraction_jobs(status);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_created_at ON extraction_jobs(created_at);

-- ==================== SYSTEM CONFIG TABLE ====================
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    encrypted BOOLEAN DEFAULT FALSE,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ==================== ENHANCE EXISTING TABLES ====================

-- Add external integration columns to customers
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS external_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS external_source VARCHAR(50),
ADD COLUMN IF NOT EXISTS billing_address JSONB,
ADD COLUMN IF NOT EXISTS shipping_address JSONB,
ADD COLUMN IF NOT EXISTS is_paying_customer BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS meta_data JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_customers_external_id ON customers(external_id);
CREATE INDEX IF NOT EXISTS idx_customers_external_source ON customers(external_source);

-- Add external integration columns to products
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS external_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS external_source VARCHAR(50),
ADD COLUMN IF NOT EXISTS short_description TEXT,
ADD COLUMN IF NOT EXISTS regular_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS sale_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS categories TEXT,
ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS meta_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) DEFAULT 'instock',
ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS manage_stock BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS weight DECIMAL(8,3),
ADD COLUMN IF NOT EXISTS dimensions JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_products_external_id ON products(external_id);
CREATE INDEX IF NOT EXISTS idx_products_external_source ON products(external_source);
CREATE INDEX IF NOT EXISTS idx_products_stock_status ON products(stock_status);

-- Add external integration columns to suppliers
ALTER TABLE suppliers 
ADD COLUMN IF NOT EXISTS external_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS external_source VARCHAR(50),
ADD COLUMN IF NOT EXISTS contact_details JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_suppliers_external_id ON suppliers(external_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_external_source ON suppliers(external_source);

-- ==================== ORDERS TABLE (if not exists) ====================
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(100),
    external_source VARCHAR(50),
    customer_id UUID REFERENCES customers(id),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    currency VARCHAR(3) DEFAULT 'USD',
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(12,2) DEFAULT 0,
    tax_total DECIMAL(12,2) DEFAULT 0,
    shipping_total DECIMAL(12,2) DEFAULT 0,
    payment_method VARCHAR(100),
    billing_address JSONB,
    shipping_address JSONB,
    line_items JSONB DEFAULT '[]',
    meta_data JSONB DEFAULT '{}',
    date_created TIMESTAMP,
    date_modified TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_external_id ON orders(external_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date_created ON orders(date_created);

-- ==================== INVENTORY MOVEMENTS ENHANCEMENTS ====================
-- Add new movement types for extraction and sync
ALTER TABLE inventory_movements 
ADD CONSTRAINT check_movement_type_extended 
CHECK (movement_type IN (
    'receipt', 'shipment', 'adjustment', 'transfer', 'return',
    'sync', 'extraction_update', 'initial_stock', 'woocommerce_sync'
));

-- Drop the old constraint if it exists
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS check_movement_type;

-- ==================== SAMPLE DATA FOR TESTING ====================
-- Insert sample system configuration
INSERT INTO system_config (key, value, description) VALUES 
('woocommerce_api_version', 'wc/v3', 'WooCommerce API version')
ON CONFLICT (key) DO NOTHING;

-- Insert sample import history record
INSERT INTO import_history (
    file_name, table_name, records_total, records_imported, 
    records_skipped, error_count, status
) VALUES (
    'sample_migration.csv', 'customers', 100, 95, 5, 2, 'completed'
) ON CONFLICT DO NOTHING;

-- ==================== COMMENTS ====================
COMMENT ON TABLE import_history IS 'Tracks file import operations and their results';
COMMENT ON TABLE extraction_jobs IS 'Manages supply chain data extraction jobs from external sources';
COMMENT ON TABLE system_config IS 'Stores system-wide configuration settings';
COMMENT ON COLUMN customers.external_id IS 'External system identifier (e.g., WooCommerce customer ID)';
COMMENT ON COLUMN products.external_id IS 'External system identifier (e.g., WooCommerce product ID)';
COMMENT ON COLUMN orders.external_id IS 'External system identifier (e.g., WooCommerce order ID)';

-- ==================== MIGRATION COMPLETION ====================
-- Update migration tracking
INSERT INTO schema_migrations (version, applied_at) 
VALUES ('0009_unified_extractor_migration', NOW())
ON CONFLICT (version) DO UPDATE SET applied_at = NOW();