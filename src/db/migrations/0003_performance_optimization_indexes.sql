-- Performance Optimization Indexes Migration
-- Created for production-grade performance improvements

-- ==================== INVENTORY PERFORMANCE INDEXES ====================

-- Composite index for inventory queries with warehouse and stock status
CREATE INDEX IF NOT EXISTS idx_inventory_warehouse_stock_status
ON inventory (warehouse_id, stock_status, quantity_available)
WHERE quantity_available > 0;

-- Composite index for low stock alerts
CREATE INDEX IF NOT EXISTS idx_inventory_reorder_alerts
ON inventory (warehouse_id, reorder_point, quantity_available)
WHERE reorder_point IS NOT NULL AND quantity_available <= reorder_point;

-- Index for inventory value calculations
CREATE INDEX IF NOT EXISTS idx_inventory_value_calculation
ON inventory (warehouse_id, quantity_on_hand, average_cost)
WHERE quantity_on_hand > 0 AND average_cost IS NOT NULL;

-- Partial index for active products only
CREATE INDEX IF NOT EXISTS idx_products_active_sku
ON products (sku, name, category)
WHERE is_active = true;

-- ==================== ANALYTICS PERFORMANCE INDEXES ====================

-- Time-series index for movements by date range
CREATE INDEX IF NOT EXISTS idx_inventory_movements_time_series
ON inventory_movements (created_at DESC, movement_type, product_id, warehouse_id);

-- Index for movement aggregations by product
CREATE INDEX IF NOT EXISTS idx_movements_product_aggregation
ON inventory_movements (product_id, movement_type, created_at DESC, quantity, unit_cost)
WHERE quantity IS NOT NULL;

-- Index for warehouse-specific movement analysis
CREATE INDEX IF NOT EXISTS idx_movements_warehouse_analysis
ON inventory_movements (warehouse_id, created_at DESC, movement_type, total_cost)
WHERE total_cost IS NOT NULL;

-- ==================== SUPPLIER PERFORMANCE INDEXES ====================

-- Supplier performance analysis index
CREATE INDEX IF NOT EXISTS idx_suppliers_performance_analysis
ON suppliers (is_active, performance_rating DESC, lead_time_days, industry);

-- Price list performance index
CREATE INDEX IF NOT EXISTS idx_price_lists_active_supplier
ON price_lists (supplier_id, status, effective_date DESC, expiry_date)
WHERE status IN ('active', 'approved');

-- Price list items with SKU lookup
CREATE INDEX IF NOT EXISTS idx_price_list_items_sku_lookup
ON price_list_items (sku, price_list_id, unit_price, min_quantity);

-- ==================== CUSTOMER ANALYTICS INDEXES ====================

-- Customer purchase history analysis
CREATE INDEX IF NOT EXISTS idx_customers_purchase_analysis
ON customers (created_at DESC, company_name)
WHERE purchase_history != '[]'::jsonb;

-- Purchase orders customer analysis
CREATE INDEX IF NOT EXISTS idx_purchase_orders_customer_analysis
ON purchase_orders (customer_id, order_date DESC, status, total_amount);

-- Purchase order items for customer insights
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_analytics
ON purchase_order_items (product_id, created_at DESC, quantity, unit_price);

-- ==================== TIME SERIES ANALYTICS INDEXES ====================

-- Daily aggregates for fast dashboard queries
CREATE INDEX IF NOT EXISTS idx_analytics_daily_date_dimension
ON analytics_daily_aggregates (date DESC, dimension, dimension_id, sales_revenue);

-- Monthly aggregates for trend analysis
CREATE INDEX IF NOT EXISTS idx_analytics_monthly_trends
ON analytics_monthly_aggregates (year DESC, month DESC, dimension, revenue_growth);

-- Time series metrics for real-time dashboards
CREATE INDEX IF NOT EXISTS idx_time_series_metrics_dashboard
ON time_series_metrics (timestamp DESC, metric_name, dimension1, value);

-- ==================== UPLOAD AND PROCESSING INDEXES ====================

-- Upload history performance
CREATE INDEX IF NOT EXISTS idx_upload_history_supplier_status
ON upload_history (supplier_id, status, upload_date DESC, success_count);

-- ==================== JSONB PERFORMANCE INDEXES ====================

-- GIN indexes for JSONB columns for fast searches
CREATE INDEX IF NOT EXISTS idx_inventory_metadata_gin
ON inventory USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_products_metadata_gin
ON products USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_suppliers_contact_details_gin
ON suppliers USING GIN (contact_details);

CREATE INDEX IF NOT EXISTS idx_customers_address_gin
ON customers USING GIN (address);

-- ==================== MATERIALIZED VIEWS FOR PERFORMANCE ====================

-- Materialized view for inventory summary
DROP MATERIALIZED VIEW IF EXISTS mv_inventory_summary;
CREATE MATERIALIZED VIEW mv_inventory_summary AS
SELECT 
    i.warehouse_id,
    p.category,
    COUNT(*) as total_items,
    SUM(i.quantity_on_hand) as total_quantity,
    SUM(i.quantity_on_hand * COALESCE(i.average_cost, 0)) as total_value,
    SUM(CASE WHEN i.quantity_available <= COALESCE(i.reorder_point, 0) THEN 1 ELSE 0 END) as items_needing_reorder,
    SUM(CASE WHEN i.quantity_available = 0 THEN 1 ELSE 0 END) as out_of_stock_items,
    AVG(i.quantity_on_hand) as avg_quantity,
    COUNT(CASE WHEN i.last_movement > NOW() - INTERVAL '30 days' THEN 1 END) as active_items_30d
FROM inventory i
INNER JOIN products p ON i.product_id = p.id
WHERE p.is_active = true
GROUP BY i.warehouse_id, p.category;

CREATE UNIQUE INDEX ON mv_inventory_summary (warehouse_id, category);

-- Materialized view for supplier performance
DROP MATERIALIZED VIEW IF EXISTS mv_supplier_performance;
CREATE MATERIALIZED VIEW mv_supplier_performance AS
SELECT 
    s.id as supplier_id,
    s.company_name,
    s.performance_rating,
    s.lead_time_days,
    COUNT(DISTINCT pl.id) as active_price_lists,
    COUNT(DISTINCT p.id) as total_products,
    AVG(pli.unit_price) as avg_unit_price,
    COUNT(DISTINCT spo.id) as total_purchase_orders,
    AVG(EXTRACT(days FROM spo.delivered_at - spo.order_date)) as avg_delivery_days,
    SUM(spo.total_amount) as total_order_value,
    COUNT(CASE WHEN spo.delivered_at <= spo.expected_delivery_date THEN 1 END)::DECIMAL / 
        NULLIF(COUNT(CASE WHEN spo.delivered_at IS NOT NULL THEN 1 END), 0) * 100 as on_time_delivery_rate
FROM suppliers s
LEFT JOIN price_lists pl ON s.id = pl.supplier_id AND pl.status = 'active'
LEFT JOIN products p ON s.id = p.supplier_id AND p.is_active = true
LEFT JOIN price_list_items pli ON pl.id = pli.price_list_id
LEFT JOIN supplier_purchase_orders spo ON s.id = spo.supplier_id 
    AND spo.created_at > NOW() - INTERVAL '12 months'
WHERE s.is_active = true
GROUP BY s.id, s.company_name, s.performance_rating, s.lead_time_days;

CREATE UNIQUE INDEX ON mv_supplier_performance (supplier_id);

-- Materialized view for customer analytics
DROP MATERIALIZED VIEW IF EXISTS mv_customer_analytics;
CREATE MATERIALIZED VIEW mv_customer_analytics AS
SELECT 
    c.id as customer_id,
    c.company_name,
    c.created_at as customer_since,
    COUNT(DISTINCT po.id) as total_orders,
    SUM(po.total_amount) as total_spent,
    AVG(po.total_amount) as avg_order_value,
    MAX(po.order_date) as last_order_date,
    COUNT(CASE WHEN po.order_date > NOW() - INTERVAL '90 days' THEN 1 END) as orders_last_90d,
    COUNT(CASE WHEN po.order_date > NOW() - INTERVAL '30 days' THEN 1 END) as orders_last_30d,
    EXTRACT(days FROM NOW() - MAX(po.order_date)) as days_since_last_order,
    COUNT(DISTINCT poi.product_id) as unique_products_purchased
FROM customers c
LEFT JOIN purchase_orders po ON c.id = po.customer_id
LEFT JOIN purchase_order_items poi ON po.id = poi.purchase_order_id
GROUP BY c.id, c.company_name, c.created_at;

CREATE UNIQUE INDEX ON mv_customer_analytics (customer_id);

-- ==================== PERFORMANCE STATISTICS ====================

-- Update table statistics for better query planning
ANALYZE inventory;
ANALYZE inventory_movements;
ANALYZE products;
ANALYZE suppliers;
ANALYZE customers;
ANALYZE price_lists;
ANALYZE price_list_items;
ANALYZE purchase_orders;
ANALYZE purchase_order_items;
ANALYZE analytics_daily_aggregates;
ANALYZE analytics_monthly_aggregates;

-- ==================== REFRESH FUNCTIONS ====================

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_performance_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_inventory_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_supplier_performance;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_customer_analytics;
    
    -- Update statistics
    ANALYZE mv_inventory_summary;
    ANALYZE mv_supplier_performance;
    ANALYZE mv_customer_analytics;
END;
$$;

-- Schedule view refresh (requires pg_cron extension - optional)
-- SELECT cron.schedule('refresh-performance-views', '*/15 * * * *', 'SELECT refresh_performance_views();');

COMMIT;