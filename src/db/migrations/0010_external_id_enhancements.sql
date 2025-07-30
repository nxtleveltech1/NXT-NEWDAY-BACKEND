-- Migration: External ID Enhancements for WooCommerce/Odoo Integration
-- Created: 2025-07-30
-- Purpose: Add external_id fields and indexes for better integration with external systems

-- Add external_id to customers table if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'customers' AND column_name = 'external_id'
    ) THEN
        ALTER TABLE customers ADD COLUMN external_id INTEGER UNIQUE;
        CREATE INDEX CONCURRENTLY customers_external_id_idx ON customers(external_id) WHERE external_id IS NOT NULL;
    END IF;
END $$;

-- Add external_id to suppliers table if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'suppliers' AND column_name = 'external_id'
    ) THEN
        ALTER TABLE suppliers ADD COLUMN external_id INTEGER UNIQUE;
        CREATE INDEX CONCURRENTLY suppliers_external_id_idx ON suppliers(external_id) WHERE external_id IS NOT NULL;
    END IF;
END $$;

-- Enhance metadata indexing for better WooCommerce ID lookups
CREATE INDEX CONCURRENTLY customers_woocommerce_id_idx ON customers USING GIN ((metadata->>'woocommerce_id')) WHERE metadata ? 'woocommerce_id';
CREATE INDEX CONCURRENTLY suppliers_external_source_idx ON suppliers USING GIN ((vendor_metadata->>'external_source')) WHERE vendor_metadata ? 'external_source';

-- Add sync tracking fields
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'customers' AND column_name = 'last_sync_at'
    ) THEN
        ALTER TABLE customers ADD COLUMN last_sync_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE customers ADD COLUMN sync_source VARCHAR(50);
        ALTER TABLE customers ADD COLUMN sync_status VARCHAR(20) DEFAULT 'pending';
    END IF;
END $$;

DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'suppliers' AND column_name = 'last_sync_at'
    ) THEN
        ALTER TABLE suppliers ADD COLUMN last_sync_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE suppliers ADD COLUMN sync_source VARCHAR(50);
        ALTER TABLE suppliers ADD COLUMN sync_status VARCHAR(20) DEFAULT 'pending';
    END IF;
END $$;

DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'last_sync_at'
    ) THEN
        ALTER TABLE products ADD COLUMN last_sync_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE products ADD COLUMN sync_source VARCHAR(50);
        ALTER TABLE products ADD COLUMN sync_status VARCHAR(20) DEFAULT 'pending';
    END IF;
END $$;

-- Create external integration tracking table
CREATE TABLE IF NOT EXISTS external_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_name VARCHAR(100) NOT NULL,
    integration_type VARCHAR(50) NOT NULL, -- woocommerce, odoo, shopify, etc.
    status VARCHAR(20) DEFAULT 'active', -- active, inactive, error
    last_sync_at TIMESTAMP WITH TIME ZONE,
    sync_frequency_minutes INTEGER DEFAULT 60,
    config JSONB DEFAULT '{}',
    stats JSONB DEFAULT '{}', -- sync statistics
    error_log JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(integration_name, integration_type)
);

-- Create sync log table for tracking all sync operations
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID REFERENCES external_integrations(id),
    entity_type VARCHAR(50) NOT NULL, -- customer, supplier, product, order
    entity_id UUID,
    external_id VARCHAR(100),
    operation VARCHAR(20) NOT NULL, -- create, update, delete, sync
    status VARCHAR(20) NOT NULL, -- success, failed, skipped
    records_processed INTEGER DEFAULT 0,
    records_success INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    error_details JSONB,
    sync_duration_ms INTEGER,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    INDEX sync_logs_integration_idx (integration_id),
    INDEX sync_logs_entity_type_idx (entity_type),
    INDEX sync_logs_status_idx (status),
    INDEX sync_logs_started_at_idx (started_at)
);

-- Add indexes for better sync performance
CREATE INDEX CONCURRENTLY customers_sync_status_idx ON customers(sync_status, last_sync_at);
CREATE INDEX CONCURRENTLY suppliers_sync_status_idx ON suppliers(sync_status, last_sync_at);
CREATE INDEX CONCURRENTLY products_sync_status_idx ON products(sync_status, last_sync_at);

-- Create composite indexes for external lookups
CREATE INDEX CONCURRENTLY customers_external_composite_idx ON customers(external_id, sync_source) WHERE external_id IS NOT NULL;
CREATE INDEX CONCURRENTLY suppliers_external_composite_idx ON suppliers(external_id, sync_source) WHERE external_id IS NOT NULL;

-- Insert default WooCommerce integration record
INSERT INTO external_integrations (
    integration_name, 
    integration_type, 
    status, 
    config,
    stats
) VALUES (
    'WooCommerce Primary',
    'woocommerce',
    'active',
    '{"api_url": "http://localhost:5000/api", "batch_size": 100, "timeout_ms": 30000}',
    '{"total_synced": 0, "last_customers": 0, "last_products": 0, "last_orders": 0}'
) ON CONFLICT (integration_name, integration_type) DO NOTHING;

-- Add update triggers for timestamps
CREATE OR REPLACE FUNCTION update_sync_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_update_sync_timestamp
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_sync_timestamp();

CREATE TRIGGER suppliers_update_sync_timestamp
    BEFORE UPDATE ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION update_sync_timestamp();

CREATE TRIGGER products_update_sync_timestamp
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_sync_timestamp();

-- Add performance monitoring view
CREATE OR REPLACE VIEW sync_performance_summary AS
SELECT 
    ei.integration_name,
    ei.integration_type,
    ei.status,
    ei.last_sync_at,
    COUNT(sl.id) as total_sync_operations,
    COUNT(CASE WHEN sl.status = 'success' THEN 1 END) as successful_operations,
    COUNT(CASE WHEN sl.status = 'failed' THEN 1 END) as failed_operations,
    AVG(sl.sync_duration_ms) as avg_sync_duration_ms,
    SUM(sl.records_processed) as total_records_processed,
    SUM(sl.records_success) as total_records_success,
    SUM(sl.records_failed) as total_records_failed
FROM external_integrations ei
LEFT JOIN sync_logs sl ON ei.id = sl.integration_id
    AND sl.started_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY ei.id, ei.integration_name, ei.integration_type, ei.status, ei.last_sync_at;

-- Comments for documentation
COMMENT ON TABLE external_integrations IS 'Tracks all external system integrations (WooCommerce, Odoo, etc.)';
COMMENT ON TABLE sync_logs IS 'Detailed log of all sync operations with external systems';
COMMENT ON VIEW sync_performance_summary IS 'Performance summary for external integrations over the last 7 days';

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE ON external_integrations TO nxt_app_user;
-- GRANT SELECT, INSERT, UPDATE ON sync_logs TO nxt_app_user;