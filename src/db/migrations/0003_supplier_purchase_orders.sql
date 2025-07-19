-- Migration: 0003_supplier_purchase_orders
-- Description: Add supplier purchase order system for procurement workflow
-- Date: 2025-07-19
-- Dependencies: 0002_customer_purchase_history.sql

-- ==================== SUPPLIER PURCHASE ORDERS ====================

-- Supplier Purchase Orders (orders TO suppliers FROM us)
CREATE TABLE IF NOT EXISTS "supplier_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" varchar(100) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"order_date" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_delivery_date" timestamp with time zone,
	"requested_delivery_date" timestamp with time zone,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"approval_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"subtotal" numeric(12,2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12,2) DEFAULT '0' NOT NULL,
	"shipping_amount" numeric(12,2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12,2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12,2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"payment_terms" varchar(50) DEFAULT 'NET30',
	"payment_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"delivery_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"received_by" uuid,
	"price_list_id" uuid,
	"customer_order_id" uuid,
	"requisition_number" varchar(100),
	"notes" text,
	"internal_notes" text,
	"supplier_notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_purchase_orders_po_number_unique" UNIQUE("po_number")
);

-- Foreign key constraints
ALTER TABLE "supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_customer_order_id_purchase_orders_id_fk" FOREIGN KEY ("customer_order_id") REFERENCES "purchase_orders"("id") ON DELETE no action ON UPDATE no action;

-- Indexes for supplier purchase orders
CREATE INDEX IF NOT EXISTS "supplier_po_supplier_idx" ON "supplier_purchase_orders" ("supplier_id");
CREATE INDEX IF NOT EXISTS "supplier_po_order_date_idx" ON "supplier_purchase_orders" ("order_date");
CREATE INDEX IF NOT EXISTS "supplier_po_status_idx" ON "supplier_purchase_orders" ("status");
CREATE INDEX IF NOT EXISTS "supplier_po_approval_status_idx" ON "supplier_purchase_orders" ("approval_status");
CREATE INDEX IF NOT EXISTS "supplier_po_number_idx" ON "supplier_purchase_orders" ("po_number");
CREATE INDEX IF NOT EXISTS "supplier_po_expected_delivery_idx" ON "supplier_purchase_orders" ("expected_delivery_date");
CREATE INDEX IF NOT EXISTS "supplier_po_created_at_idx" ON "supplier_purchase_orders" ("created_at");
CREATE INDEX IF NOT EXISTS "supplier_po_supplier_status_idx" ON "supplier_purchase_orders" ("supplier_id","status");
CREATE INDEX IF NOT EXISTS "supplier_po_price_list_idx" ON "supplier_purchase_orders" ("price_list_id");

-- Supplier Purchase Order Items
CREATE TABLE IF NOT EXISTS "supplier_purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_purchase_order_id" uuid NOT NULL,
	"product_id" uuid,
	"sku" varchar(100) NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"description" text,
	"quantity_ordered" integer NOT NULL,
	"quantity_received" integer DEFAULT 0 NOT NULL,
	"quantity_accepted" integer DEFAULT 0 NOT NULL,
	"quantity_rejected" integer DEFAULT 0 NOT NULL,
	"unit_price" numeric(10,2) NOT NULL,
	"discount_percent" numeric(5,2) DEFAULT '0',
	"discount_amount" numeric(10,2) DEFAULT '0',
	"line_total" numeric(12,2) NOT NULL,
	"tax_rate" numeric(5,2) DEFAULT '0',
	"tax_amount" numeric(10,2) DEFAULT '0',
	"warehouse_id" uuid,
	"location_id" uuid,
	"requested_delivery_date" timestamp with time zone,
	"price_list_item_id" uuid,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"qc_status" varchar(50) DEFAULT 'pending',
	"qc_notes" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Foreign key constraints for supplier purchase order items
ALTER TABLE "supplier_purchase_order_items" ADD CONSTRAINT "supplier_purchase_order_items_supplier_purchase_order_id_supplier_purchase_orders_id_fk" FOREIGN KEY ("supplier_purchase_order_id") REFERENCES "supplier_purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "supplier_purchase_order_items" ADD CONSTRAINT "supplier_purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_purchase_order_items" ADD CONSTRAINT "supplier_purchase_order_items_price_list_item_id_price_list_items_id_fk" FOREIGN KEY ("price_list_item_id") REFERENCES "price_list_items"("id") ON DELETE no action ON UPDATE no action;

-- Indexes for supplier purchase order items
CREATE INDEX IF NOT EXISTS "supplier_po_items_order_idx" ON "supplier_purchase_order_items" ("supplier_purchase_order_id");
CREATE INDEX IF NOT EXISTS "supplier_po_items_product_idx" ON "supplier_purchase_order_items" ("product_id");
CREATE INDEX IF NOT EXISTS "supplier_po_items_sku_idx" ON "supplier_purchase_order_items" ("sku");
CREATE INDEX IF NOT EXISTS "supplier_po_items_status_idx" ON "supplier_purchase_order_items" ("status");
CREATE INDEX IF NOT EXISTS "supplier_po_items_price_list_item_idx" ON "supplier_purchase_order_items" ("price_list_item_id");

-- Purchase Order Receipts (receiving goods)
CREATE TABLE IF NOT EXISTS "purchase_order_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" varchar(100) NOT NULL,
	"supplier_purchase_order_id" uuid NOT NULL,
	"received_date" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"carrier_name" varchar(255),
	"tracking_number" varchar(100),
	"packing_slip_number" varchar(100),
	"invoice_number" varchar(100),
	"qc_required" boolean DEFAULT false NOT NULL,
	"qc_status" varchar(50) DEFAULT 'not_required',
	"qc_completed_at" timestamp with time zone,
	"qc_completed_by" uuid,
	"has_discrepancies" boolean DEFAULT false NOT NULL,
	"discrepancy_notes" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_receipts_receipt_number_unique" UNIQUE("receipt_number")
);

-- Foreign key constraints for purchase order receipts
ALTER TABLE "purchase_order_receipts" ADD CONSTRAINT "purchase_order_receipts_supplier_purchase_order_id_supplier_purchase_orders_id_fk" FOREIGN KEY ("supplier_purchase_order_id") REFERENCES "supplier_purchase_orders"("id") ON DELETE no action ON UPDATE no action;

-- Indexes for purchase order receipts
CREATE INDEX IF NOT EXISTS "po_receipts_supplier_po_idx" ON "purchase_order_receipts" ("supplier_purchase_order_id");
CREATE INDEX IF NOT EXISTS "po_receipts_received_date_idx" ON "purchase_order_receipts" ("received_date");
CREATE INDEX IF NOT EXISTS "po_receipts_status_idx" ON "purchase_order_receipts" ("status");
CREATE INDEX IF NOT EXISTS "po_receipts_warehouse_idx" ON "purchase_order_receipts" ("warehouse_id");
CREATE INDEX IF NOT EXISTS "po_receipts_number_idx" ON "purchase_order_receipts" ("receipt_number");

-- Purchase Order Receipt Items
CREATE TABLE IF NOT EXISTS "purchase_order_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"supplier_purchase_order_item_id" uuid NOT NULL,
	"product_id" uuid,
	"sku" varchar(100) NOT NULL,
	"quantity_ordered" integer NOT NULL,
	"quantity_received" integer NOT NULL,
	"quantity_accepted" integer NOT NULL,
	"quantity_rejected" integer DEFAULT 0 NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid,
	"qc_status" varchar(50) DEFAULT 'pending',
	"qc_notes" text,
	"batch_number" varchar(100),
	"lot_number" varchar(100),
	"serial_numbers" jsonb DEFAULT '[]'::jsonb,
	"expiry_date" date,
	"manufacturing_date" date,
	"unit_cost" numeric(10,2),
	"total_cost" numeric(12,2),
	"discrepancy_type" varchar(50),
	"discrepancy_notes" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Foreign key constraints for purchase order receipt items
ALTER TABLE "purchase_order_receipt_items" ADD CONSTRAINT "purchase_order_receipt_items_receipt_id_purchase_order_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "purchase_order_receipts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "purchase_order_receipt_items" ADD CONSTRAINT "purchase_order_receipt_items_supplier_purchase_order_item_id_supplier_purchase_order_items_id_fk" FOREIGN KEY ("supplier_purchase_order_item_id") REFERENCES "supplier_purchase_order_items"("id") ON DELETE no action ON UPDATE no action;

-- Indexes for purchase order receipt items
CREATE INDEX IF NOT EXISTS "po_receipt_items_receipt_idx" ON "purchase_order_receipt_items" ("receipt_id");
CREATE INDEX IF NOT EXISTS "po_receipt_items_supplier_po_item_idx" ON "purchase_order_receipt_items" ("supplier_purchase_order_item_id");
CREATE INDEX IF NOT EXISTS "po_receipt_items_product_idx" ON "purchase_order_receipt_items" ("product_id");
CREATE INDEX IF NOT EXISTS "po_receipt_items_sku_idx" ON "purchase_order_receipt_items" ("sku");
CREATE INDEX IF NOT EXISTS "po_receipt_items_warehouse_idx" ON "purchase_order_receipt_items" ("warehouse_id");

-- ==================== TRIGGERS FOR AUDIT TRAIL ====================

-- Update trigger for supplier_purchase_orders
CREATE OR REPLACE FUNCTION update_supplier_purchase_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER supplier_purchase_orders_updated_at 
    BEFORE UPDATE ON supplier_purchase_orders 
    FOR EACH ROW 
    EXECUTE FUNCTION update_supplier_purchase_orders_updated_at();

-- Update trigger for supplier_purchase_order_items
CREATE OR REPLACE FUNCTION update_supplier_purchase_order_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER supplier_purchase_order_items_updated_at 
    BEFORE UPDATE ON supplier_purchase_order_items 
    FOR EACH ROW 
    EXECUTE FUNCTION update_supplier_purchase_order_items_updated_at();

-- Update trigger for purchase_order_receipts
CREATE OR REPLACE FUNCTION update_purchase_order_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER purchase_order_receipts_updated_at 
    BEFORE UPDATE ON purchase_order_receipts 
    FOR EACH ROW 
    EXECUTE FUNCTION update_purchase_order_receipts_updated_at();

-- Update trigger for purchase_order_receipt_items
CREATE OR REPLACE FUNCTION update_purchase_order_receipt_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER purchase_order_receipt_items_updated_at 
    BEFORE UPDATE ON purchase_order_receipt_items 
    FOR EACH ROW 
    EXECUTE FUNCTION update_purchase_order_receipt_items_updated_at();

-- ==================== SUPPLIER PO BUSINESS LOGIC TRIGGERS ====================

-- Auto-generate PO number if not provided
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
        NEW.po_number := 'PO-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(NEXTVAL('po_number_sequence')::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create sequence for PO numbers
CREATE SEQUENCE IF NOT EXISTS po_number_sequence START 1;

CREATE TRIGGER auto_generate_po_number 
    BEFORE INSERT ON supplier_purchase_orders 
    FOR EACH ROW 
    EXECUTE FUNCTION generate_po_number();

-- Auto-generate receipt number if not provided
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
        NEW.receipt_number := 'RCP-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(NEXTVAL('receipt_number_sequence')::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create sequence for receipt numbers
CREATE SEQUENCE IF NOT EXISTS receipt_number_sequence START 1;

CREATE TRIGGER auto_generate_receipt_number 
    BEFORE INSERT ON purchase_order_receipts 
    FOR EACH ROW 
    EXECUTE FUNCTION generate_receipt_number();

-- Update supplier purchase order totals when items change
CREATE OR REPLACE FUNCTION update_supplier_po_totals()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE supplier_purchase_orders 
    SET 
        subtotal = (
            SELECT COALESCE(SUM(line_total), 0) 
            FROM supplier_purchase_order_items 
            WHERE supplier_purchase_order_id = COALESCE(NEW.supplier_purchase_order_id, OLD.supplier_purchase_order_id)
        ),
        total_amount = (
            SELECT COALESCE(SUM(line_total), 0) + 
                   COALESCE(tax_amount, 0) + 
                   COALESCE(shipping_amount, 0) - 
                   COALESCE(discount_amount, 0)
            FROM supplier_purchase_order_items 
            WHERE supplier_purchase_order_id = COALESCE(NEW.supplier_purchase_order_id, OLD.supplier_purchase_order_id)
        ),
        updated_at = now()
    WHERE id = COALESCE(NEW.supplier_purchase_order_id, OLD.supplier_purchase_order_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

CREATE TRIGGER update_supplier_po_totals_trigger 
    AFTER INSERT OR UPDATE OR DELETE ON supplier_purchase_order_items 
    FOR EACH ROW 
    EXECUTE FUNCTION update_supplier_po_totals();

-- Comments for documentation
COMMENT ON TABLE supplier_purchase_orders IS 'Purchase orders sent to suppliers for procurement';
COMMENT ON TABLE supplier_purchase_order_items IS 'Line items for supplier purchase orders';
COMMENT ON TABLE purchase_order_receipts IS 'Receipts for goods received from suppliers';
COMMENT ON TABLE purchase_order_receipt_items IS 'Individual items received in each receipt';

COMMENT ON COLUMN supplier_purchase_orders.status IS 'Status: draft, pending_approval, approved, sent, acknowledged, in_transit, delivered, completed, cancelled';
COMMENT ON COLUMN supplier_purchase_orders.approval_status IS 'Approval: pending, approved, rejected, auto_approved';
COMMENT ON COLUMN supplier_purchase_order_items.status IS 'Item status: pending, ordered, in_transit, received, partially_received, completed, cancelled';
COMMENT ON COLUMN purchase_order_receipts.status IS 'Receipt status: draft, in_progress, completed, discrepancies, resolved';