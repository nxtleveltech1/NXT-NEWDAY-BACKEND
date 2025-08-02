-- =========================================
-- PERFORMANCE OPTIMIZATION INDEXES
-- Designed for 1000+ concurrent users on nxtdotx.co.za
-- Target: Sub-second response times under high load
-- =========================================

-- Create indexes concurrently to avoid blocking
BEGIN;

-- =========================================
-- USER AUTHENTICATION & MANAGEMENT INDEXES
-- =========================================

-- Primary user lookup indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_auth_id ON users(auth_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_auth_id_unique ON users(auth_id) WHERE auth_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_organization_id ON users(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_status ON users(status) WHERE status IS NOT NULL;

-- User session and activity indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_login ON users(last_login_at) WHERE last_login_at IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active ON users(status, last_login_at) WHERE status = 'active';

-- =========================================
-- ORGANIZATION & TENANT INDEXES
-- =========================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_created_at ON organizations(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_status ON organizations(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_name ON organizations(name);

-- =========================================
-- PRODUCT CATALOG INDEXES
-- =========================================

-- Core product lookup indexes
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_products_sku_unique ON products(sku) WHERE sku IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_created_at ON products(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_updated_at ON products(updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_organization_id ON products(organization_id);

-- Product search and filtering indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active_by_category ON products(category_id, status) WHERE status = 'active';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active_by_supplier ON products(supplier_id, status) WHERE status = 'active';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_price_range ON products(base_price) WHERE base_price IS NOT NULL;

-- Full-text search indexes for product search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_search ON products USING gin(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '')));

-- =========================================
-- INVENTORY MANAGEMENT INDEXES
-- =========================================

-- Core inventory tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_product_id ON inventory(product_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_location_id ON inventory(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_last_updated ON inventory(last_updated);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_stock_level ON inventory(stock_level);

-- Low stock alerts and reporting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_low_stock ON inventory(product_id, stock_level) WHERE stock_level <= reorder_level;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_reorder_needed ON inventory(reorder_level, stock_level) WHERE stock_level <= reorder_level;

-- Multi-column indexes for complex queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_product_location ON inventory(product_id, location_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_org_product ON inventory(organization_id, product_id);

-- =========================================
-- ORDER PROCESSING INDEXES
-- =========================================

-- Core order lookup indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_organization_id ON orders(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- Order processing workflow indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_pending ON orders(status, created_at) WHERE status IN ('pending', 'processing');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_recent ON orders(customer_id, order_date DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_org_status ON orders(organization_id, status);

-- Order items for detailed queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_order_product ON order_items(order_id, product_id);

-- =========================================
-- CUSTOMER MANAGEMENT INDEXES
-- =========================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_email ON customers(email);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_email_unique ON customers(email) WHERE email IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_organization_id ON customers(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_created_at ON customers(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_status ON customers(status);

-- Customer search and segmentation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_name ON customers(first_name, last_name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_active ON customers(organization_id, status) WHERE status = 'active';

-- =========================================
-- SUPPLIER MANAGEMENT INDEXES
-- =========================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppliers_organization_id ON suppliers(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppliers_status ON suppliers(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppliers_name ON suppliers(supplier_name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppliers_created_at ON suppliers(created_at);

-- Supplier performance tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppliers_active ON suppliers(organization_id, status) WHERE status = 'active';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppliers_contact ON suppliers(contact_email) WHERE contact_email IS NOT NULL;

-- =========================================
-- SUPPLIER PRICING INDEXES
-- =========================================

-- Core pricing lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_prices_product_supplier ON supplier_prices(product_id, supplier_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_prices_effective_date ON supplier_prices(effective_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_prices_product_id ON supplier_prices(product_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_prices_supplier_id ON supplier_prices(supplier_id);

-- Current pricing queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_prices_current ON supplier_prices(product_id, supplier_id, effective_date DESC) 
WHERE end_date IS NULL OR end_date > CURRENT_DATE;

-- Price comparison and analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_prices_org_product ON supplier_prices(organization_id, product_id);

-- =========================================
-- FINANCIAL MANAGEMENT INDEXES
-- =========================================

-- Invoice management
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_organization_id ON invoices(organization_id);

-- Invoice processing workflows
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_overdue ON invoices(due_date, status) WHERE status != 'paid' AND due_date < CURRENT_DATE;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_pending_payment ON invoices(status, due_date) WHERE status IN ('sent', 'overdue');

-- Payment tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_status ON payments(status);

-- =========================================
-- COMMUNICATION SYSTEM INDEXES
-- =========================================

-- Message threading and retrieval
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_message_type ON messages(message_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread_id ON messages(thread_id) WHERE thread_id IS NOT NULL;

-- Unread messages and notifications
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_unread ON messages(recipient_id, read_at) WHERE read_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation ON messages(sender_id, recipient_id, created_at);

-- Email integration
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_message_id ON emails(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_sent_at ON emails(sent_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_status ON emails(status);

-- =========================================
-- ANALYTICS & REPORTING INDEXES
-- =========================================

-- Sales analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_analytics_date ON orders(order_date, organization_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_revenue ON orders(order_date, total_amount) WHERE status = 'completed';

-- Inventory analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_analytics ON inventory(organization_id, last_updated, stock_level);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_analytics ON products(organization_id, category_id, status, created_at);

-- Customer analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_analytics ON customers(organization_id, created_at, status);

-- =========================================
-- AUDIT TRAIL INDEXES
-- =========================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_table_name ON audit_log(table_name) WHERE table_name IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_operation ON audit_log(operation) WHERE operation IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_timestamp ON audit_log(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_record_id ON audit_log(record_id) WHERE record_id IS NOT NULL;

-- =========================================
-- FILE UPLOADS & DOCUMENT MANAGEMENT
-- =========================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_uploads_entity_type ON file_uploads(entity_type, entity_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_uploads_user_id ON file_uploads(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_uploads_created_at ON file_uploads(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_uploads_organization_id ON file_uploads(organization_id);

-- =========================================
-- WEBSOCKET & REAL-TIME FEATURES
-- =========================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_realtime_events_user_id ON realtime_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_realtime_events_event_type ON realtime_events(event_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_realtime_events_created_at ON realtime_events(created_at);

-- =========================================
-- SYSTEM CONFIGURATION & SETTINGS
-- =========================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_system_settings_key ON system_settings(setting_key);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_system_settings_organization ON system_settings(organization_id) WHERE organization_id IS NOT NULL;

-- =========================================
-- COMPOSITE INDEXES FOR COMPLEX QUERIES
-- =========================================

-- Order processing workflow
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_workflow ON orders(organization_id, status, order_date DESC);

-- Product inventory view
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_inventory ON products(organization_id, status) 
INCLUDE (name, sku, category_id);

-- Customer order history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_orders ON orders(customer_id, order_date DESC, status);

-- Supplier product pricing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_prices ON supplier_prices(organization_id, product_id, effective_date DESC);

-- Revenue analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_analytics ON orders(organization_id, order_date, status) 
WHERE status = 'completed' INCLUDE (total_amount);

-- =========================================
-- PARTIAL INDEXES FOR SPECIFIC CONDITIONS
-- =========================================

-- Active records only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active_only ON products(organization_id, category_id) WHERE status = 'active';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_active_only ON customers(organization_id) WHERE status = 'active';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppliers_active_only ON suppliers(organization_id) WHERE status = 'active';

-- Pending orders for quick processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_pending_only ON orders(organization_id, created_at) WHERE status = 'pending';

-- Overdue invoices for collections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_overdue_only ON invoices(organization_id, due_date) 
WHERE status != 'paid' AND due_date < CURRENT_DATE;

-- Low stock alerts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_low_stock_only ON inventory(organization_id, product_id) 
WHERE stock_level <= reorder_level;

-- =========================================
-- PERFORMANCE MONITORING VIEWS
-- =========================================

-- Create materialized view for dashboard analytics (refreshed periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_analytics AS
SELECT 
    o.organization_id,
    DATE(o.order_date) as order_date,
    COUNT(*) as total_orders,
    SUM(o.total_amount) as total_revenue,
    COUNT(DISTINCT o.customer_id) as unique_customers,
    AVG(o.total_amount) as avg_order_value
FROM orders o
WHERE o.status = 'completed' 
  AND o.order_date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY o.organization_id, DATE(o.order_date);

-- Index for the materialized view
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mv_dashboard_analytics ON mv_dashboard_analytics(organization_id, order_date DESC);

-- =========================================
-- CLEANUP AND OPTIMIZATION
-- =========================================

-- Update table statistics for query planner
ANALYZE users, organizations, products, inventory, orders, customers, suppliers, invoices, messages;

-- Set autovacuum settings for high-traffic tables
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE inventory SET (autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE messages SET (autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE audit_log SET (autovacuum_vacuum_scale_factor = 0.05);

-- =========================================
-- INDEX MAINTENANCE PROCEDURES
-- =========================================

-- Create function to monitor index usage
CREATE OR REPLACE FUNCTION check_index_usage() 
RETURNS TABLE(
    schemaname TEXT,
    tablename TEXT,
    indexname TEXT,
    idx_scan BIGINT,
    idx_tup_read BIGINT,
    idx_tup_fetch BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.schemaname::TEXT,
        s.tablename::TEXT,
        s.indexrelname::TEXT,
        s.idx_scan,
        s.idx_tup_read,
        s.idx_tup_fetch
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON s.indexrelid = i.indexrelid
    WHERE s.schemaname = 'public'
    ORDER BY s.idx_scan ASC;
END;
$$ LANGUAGE plpgsql;

-- Create function to identify unused indexes
CREATE OR REPLACE FUNCTION find_unused_indexes()
RETURNS TABLE(
    schemaname TEXT,
    tablename TEXT,
    indexname TEXT,
    index_size TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.schemaname::TEXT,
        s.tablename::TEXT,
        s.indexrelname::TEXT,
        pg_size_pretty(pg_relation_size(s.indexrelid))::TEXT as index_size
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON s.indexrelid = i.indexrelid
    WHERE s.idx_scan = 0 
      AND s.schemaname = 'public'
      AND NOT i.indisunique
    ORDER BY pg_relation_size(s.indexrelid) DESC;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- =========================================
-- NOTES FOR PRODUCTION DEPLOYMENT
-- =========================================

/*
1. Run this script during low-traffic periods as index creation can be resource-intensive
2. Monitor index usage with: SELECT * FROM check_index_usage();
3. Check for unused indexes periodically with: SELECT * FROM find_unused_indexes();
4. Refresh materialized view daily: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_analytics;
5. Monitor query performance with pg_stat_statements extension
6. Consider partitioning large tables (orders, messages, audit_log) by date for better performance
7. Set up monitoring for index bloat and table statistics
*/