-- Migration: 0011_supplier_inventory
-- Description: Add supplier inventory tracking table for managing supplier stock levels and lead times
-- Date: 2025-07-30
-- Dependencies: 0001_unified_supplier_module.sql, 0006_warehouses.sql

-- ==================== SUPPLIER INVENTORY MANAGEMENT ====================

-- Supplier Inventory table (tracks supplier stock levels, lead times, and availability)
CREATE TABLE IF NOT EXISTS "supplier_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" varchar(100) NOT NULL,
	
	-- Stock levels at supplier
	"quantity_available" integer DEFAULT 0 NOT NULL,
	"quantity_allocated" integer DEFAULT 0 NOT NULL,
	"quantity_on_order" integer DEFAULT 0 NOT NULL,
	"quantity_in_production" integer DEFAULT 0 NOT NULL,
	
	-- Lead time information
	"standard_lead_time_days" integer DEFAULT 0 NOT NULL,
	"express_lead_time_days" integer,
	"current_lead_time_days" integer DEFAULT 0 NOT NULL,
	"lead_time_variance_days" integer DEFAULT 0,
	
	-- Availability and scheduling
	"next_available_date" timestamp with time zone,
	"production_schedule" jsonb DEFAULT '[]'::jsonb, -- Array of {date, quantity}
	"blackout_dates" jsonb DEFAULT '[]'::jsonb, -- Array of date ranges when supplier cannot deliver
	
	-- Minimum order quantities
	"min_order_quantity" integer DEFAULT 1 NOT NULL,
	"order_increment" integer DEFAULT 1 NOT NULL,
	"max_order_quantity" integer,
	
	-- Pricing tiers (linked to price lists)
	"default_unit_price" numeric(10, 2),
	"volume_pricing" jsonb DEFAULT '[]'::jsonb, -- Array of {minQty, price, discount}
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"price_list_item_id" uuid,
	
	-- Supplier performance metrics
	"on_time_delivery_rate" numeric(5, 2) DEFAULT 100.00,
	"quality_rating" numeric(5, 2) DEFAULT 100.00,
	"fulfillment_rate" numeric(5, 2) DEFAULT 100.00,
	"last_delivery_date" timestamp with time zone,
	"last_order_date" timestamp with time zone,
	
	-- Warehouse preferences
	"preferred_warehouse_id" uuid,
	"alternate_warehouse_ids" jsonb DEFAULT '[]'::jsonb, -- Array of warehouse IDs
	
	-- Product specifications
	"product_specifications" jsonb DEFAULT '{}'::jsonb,
	"packaging_info" jsonb DEFAULT '{}'::jsonb, -- units per case, case dimensions, weight
	"handling_requirements" jsonb DEFAULT '{}'::jsonb, -- temperature, fragile, hazmat
	
	-- Status and lifecycle
	"status" varchar(50) DEFAULT 'active' NOT NULL, -- active, discontinued, seasonal, temporarily_unavailable
	"availability_status" varchar(50) DEFAULT 'in_stock' NOT NULL, -- in_stock, low_stock, out_of_stock, made_to_order
	"discontinued_date" timestamp with time zone,
	"seasonal_availability" jsonb DEFAULT '{}'::jsonb, -- {startMonth, endMonth}
	
	-- Integration and sync
	"external_inventory_id" varchar(100),
	"last_sync_date" timestamp with time zone,
	"sync_status" varchar(50) DEFAULT 'pending', -- pending, synced, failed, disabled
	"sync_errors" jsonb DEFAULT '[]'::jsonb,
	
	-- Notes and metadata
	"notes" text,
	"internal_notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	
	-- Audit trail
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	
	-- Composite unique constraint to prevent duplicates
	CONSTRAINT "supplier_inventory_supplier_product_unique" UNIQUE("supplier_id", "product_id")
);

-- Foreign key constraints
DO $$ BEGIN
 ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_supplier_id_suppliers_id_fk" 
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_product_id_products_id_fk" 
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_preferred_warehouse_id_warehouses_id_fk" 
    FOREIGN KEY ("preferred_warehouse_id") REFERENCES "warehouses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_price_list_item_id_price_list_items_id_fk" 
    FOREIGN KEY ("price_list_item_id") REFERENCES "price_list_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "supplier_inv_supplier_idx" ON "supplier_inventory" ("supplier_id");
CREATE INDEX IF NOT EXISTS "supplier_inv_product_idx" ON "supplier_inventory" ("product_id");
CREATE INDEX IF NOT EXISTS "supplier_inv_sku_idx" ON "supplier_inventory" ("sku");
CREATE INDEX IF NOT EXISTS "supplier_inv_status_idx" ON "supplier_inventory" ("status");
CREATE INDEX IF NOT EXISTS "supplier_inv_availability_idx" ON "supplier_inventory" ("availability_status");
CREATE INDEX IF NOT EXISTS "supplier_inv_supplier_product_idx" ON "supplier_inventory" ("supplier_id", "product_id");
CREATE INDEX IF NOT EXISTS "supplier_inv_supplier_sku_idx" ON "supplier_inventory" ("supplier_id", "sku");
CREATE INDEX IF NOT EXISTS "supplier_inv_next_available_idx" ON "supplier_inventory" ("next_available_date");
CREATE INDEX IF NOT EXISTS "supplier_inv_lead_time_idx" ON "supplier_inventory" ("current_lead_time_days");
CREATE INDEX IF NOT EXISTS "supplier_inv_warehouse_idx" ON "supplier_inventory" ("preferred_warehouse_id");
CREATE INDEX IF NOT EXISTS "supplier_inv_sync_status_idx" ON "supplier_inventory" ("sync_status");
CREATE INDEX IF NOT EXISTS "supplier_inv_external_id_idx" ON "supplier_inventory" ("external_inventory_id");

-- ==================== TRIGGERS ====================

-- Update trigger for updated_at
CREATE TRIGGER supplier_inventory_updated_at 
    BEFORE UPDATE ON supplier_inventory 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update availability status based on quantity
CREATE OR REPLACE FUNCTION update_supplier_inventory_availability()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate effective available quantity
    DECLARE
        effective_quantity INTEGER;
    BEGIN
        effective_quantity := NEW.quantity_available - NEW.quantity_allocated;
        
        -- Update availability status
        IF effective_quantity <= 0 THEN
            NEW.availability_status := 'out_of_stock';
        ELSIF effective_quantity < NEW.min_order_quantity THEN
            NEW.availability_status := 'low_stock';
        ELSIF NEW.status = 'discontinued' THEN
            NEW.availability_status := 'out_of_stock';
        ELSIF NEW.quantity_in_production > 0 AND effective_quantity < (NEW.min_order_quantity * 2) THEN
            NEW.availability_status := 'made_to_order';
        ELSE
            NEW.availability_status := 'in_stock';
        END IF;
        
        RETURN NEW;
    END;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_supplier_inventory_availability_trigger 
    BEFORE INSERT OR UPDATE OF quantity_available, quantity_allocated, status ON supplier_inventory 
    FOR EACH ROW 
    EXECUTE FUNCTION update_supplier_inventory_availability();

-- ==================== HELPER FUNCTIONS ====================

-- Function to calculate total available inventory across all suppliers for a product
CREATE OR REPLACE FUNCTION get_total_supplier_inventory(p_product_id UUID)
RETURNS TABLE(
    total_available INTEGER,
    total_allocated INTEGER,
    total_on_order INTEGER,
    min_lead_time INTEGER,
    supplier_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(quantity_available - quantity_allocated), 0)::INTEGER as total_available,
        COALESCE(SUM(quantity_allocated), 0)::INTEGER as total_allocated,
        COALESCE(SUM(quantity_on_order), 0)::INTEGER as total_on_order,
        COALESCE(MIN(current_lead_time_days), 0)::INTEGER as min_lead_time,
        COUNT(DISTINCT supplier_id)::INTEGER as supplier_count
    FROM supplier_inventory
    WHERE product_id = p_product_id
        AND status = 'active'
        AND availability_status != 'out_of_stock';
END;
$$ LANGUAGE plpgsql;

-- Function to find best supplier for a product based on availability and lead time
CREATE OR REPLACE FUNCTION find_best_supplier_for_product(
    p_product_id UUID,
    p_quantity INTEGER,
    p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE(
    supplier_id UUID,
    available_quantity INTEGER,
    lead_time_days INTEGER,
    unit_price NUMERIC(10,2),
    score NUMERIC(10,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        si.supplier_id,
        (si.quantity_available - si.quantity_allocated)::INTEGER as available_quantity,
        si.current_lead_time_days::INTEGER as lead_time_days,
        si.default_unit_price,
        -- Score calculation: higher is better
        -- Factors: availability, lead time, performance, price
        (
            CASE 
                WHEN (si.quantity_available - si.quantity_allocated) >= p_quantity THEN 40
                WHEN (si.quantity_available - si.quantity_allocated) > 0 THEN 20
                ELSE 0
            END +
            CASE 
                WHEN si.current_lead_time_days <= 3 THEN 30
                WHEN si.current_lead_time_days <= 7 THEN 20
                WHEN si.current_lead_time_days <= 14 THEN 10
                ELSE 0
            END +
            (si.on_time_delivery_rate / 100 * 15) +
            (si.quality_rating / 100 * 15) +
            CASE 
                WHEN p_warehouse_id IS NOT NULL AND si.preferred_warehouse_id = p_warehouse_id THEN 10
                ELSE 0
            END
        )::NUMERIC(10,2) as score
    FROM supplier_inventory si
    INNER JOIN suppliers s ON s.id = si.supplier_id
    WHERE si.product_id = p_product_id
        AND si.status = 'active'
        AND s.is_active = true
        AND s.is_approved = true
        AND (si.quantity_available - si.quantity_allocated) > 0
    ORDER BY score DESC, si.default_unit_price ASC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql;

-- ==================== CONSTRAINTS ====================

-- Add check constraints
ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_quantities_check" 
    CHECK (quantity_available >= 0 AND quantity_allocated >= 0 AND quantity_on_order >= 0 AND quantity_in_production >= 0);

ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_lead_times_check" 
    CHECK (standard_lead_time_days >= 0 AND current_lead_time_days >= 0);

ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_min_order_check" 
    CHECK (min_order_quantity > 0 AND order_increment > 0);

ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_status_check" 
    CHECK (status IN ('active', 'discontinued', 'seasonal', 'temporarily_unavailable'));

ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_availability_check" 
    CHECK (availability_status IN ('in_stock', 'low_stock', 'out_of_stock', 'made_to_order'));

ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_sync_status_check" 
    CHECK (sync_status IN ('pending', 'synced', 'failed', 'disabled'));

-- ==================== COMMENTS ====================

COMMENT ON TABLE supplier_inventory IS 'Tracks supplier inventory levels, lead times, and availability for products';
COMMENT ON COLUMN supplier_inventory.quantity_available IS 'Total quantity available at supplier';
COMMENT ON COLUMN supplier_inventory.quantity_allocated IS 'Quantity already allocated to pending orders';
COMMENT ON COLUMN supplier_inventory.quantity_on_order IS 'Quantity we have on order from supplier';
COMMENT ON COLUMN supplier_inventory.quantity_in_production IS 'Quantity supplier is currently producing';
COMMENT ON COLUMN supplier_inventory.standard_lead_time_days IS 'Normal lead time for standard orders';
COMMENT ON COLUMN supplier_inventory.express_lead_time_days IS 'Lead time for expedited orders (if available)';
COMMENT ON COLUMN supplier_inventory.current_lead_time_days IS 'Current actual lead time (may vary from standard)';
COMMENT ON COLUMN supplier_inventory.production_schedule IS 'JSON array of upcoming production runs: [{date, quantity}]';
COMMENT ON COLUMN supplier_inventory.volume_pricing IS 'JSON array of volume-based pricing tiers: [{minQty, price, discount}]';
COMMENT ON COLUMN supplier_inventory.preferred_warehouse_id IS 'Preferred destination warehouse for this supplier-product combination';
COMMENT ON COLUMN supplier_inventory.packaging_info IS 'JSON object with packaging details: {unitsPerCase, caseDimensions, weight}';
COMMENT ON COLUMN supplier_inventory.handling_requirements IS 'JSON object with special handling needs: {temperature, fragile, hazmat}';
COMMENT ON COLUMN supplier_inventory.seasonal_availability IS 'JSON object defining seasonal availability: {startMonth, endMonth}';

-- Migration tracking
INSERT INTO schema_migrations (version, applied_at) 
VALUES ('0011_supplier_inventory', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;