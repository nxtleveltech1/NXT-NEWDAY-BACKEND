-- Migration: Supplier receipts and receipt items tables
-- These tables handle the receiving process for supplier purchase orders

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

--> statement-breakpoint

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
	"unit_cost" numeric(10, 2),
	"total_cost" numeric(12, 2),
	"discrepancy_type" varchar(50),
	"discrepancy_notes" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- Indexes for receipt tables
CREATE INDEX IF NOT EXISTS "po_receipts_supplier_po_idx" ON "purchase_order_receipts" USING btree ("supplier_purchase_order_id");
CREATE INDEX IF NOT EXISTS "po_receipts_received_date_idx" ON "purchase_order_receipts" USING btree ("received_date");
CREATE INDEX IF NOT EXISTS "po_receipts_status_idx" ON "purchase_order_receipts" USING btree ("status");
CREATE INDEX IF NOT EXISTS "po_receipts_warehouse_idx" ON "purchase_order_receipts" USING btree ("warehouse_id");
CREATE INDEX IF NOT EXISTS "po_receipts_number_idx" ON "purchase_order_receipts" USING btree ("receipt_number");

CREATE INDEX IF NOT EXISTS "po_receipt_items_receipt_idx" ON "purchase_order_receipt_items" USING btree ("receipt_id");
CREATE INDEX IF NOT EXISTS "po_receipt_items_supplier_po_item_idx" ON "purchase_order_receipt_items" USING btree ("supplier_purchase_order_item_id");
CREATE INDEX IF NOT EXISTS "po_receipt_items_product_idx" ON "purchase_order_receipt_items" USING btree ("product_id");
CREATE INDEX IF NOT EXISTS "po_receipt_items_sku_idx" ON "purchase_order_receipt_items" USING btree ("sku");
CREATE INDEX IF NOT EXISTS "po_receipt_items_warehouse_idx" ON "purchase_order_receipt_items" USING btree ("warehouse_id");

-- Foreign key constraints
ALTER TABLE "purchase_order_receipts" ADD CONSTRAINT "purchase_order_receipts_supplier_purchase_order_id_supplier_purchase_orders_id_fk" 
    FOREIGN KEY ("supplier_purchase_order_id") REFERENCES "public"."supplier_purchase_orders"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "purchase_order_receipts" ADD CONSTRAINT "purchase_order_receipts_warehouse_id_warehouses_id_fk" 
    FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "purchase_order_receipt_items" ADD CONSTRAINT "purchase_order_receipt_items_receipt_id_purchase_order_receipts_id_fk" 
    FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_order_receipts"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "purchase_order_receipt_items" ADD CONSTRAINT "purchase_order_receipt_items_supplier_purchase_order_item_id_supplier_purchase_order_items_id_fk" 
    FOREIGN KEY ("supplier_purchase_order_item_id") REFERENCES "public"."supplier_purchase_order_items"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "purchase_order_receipt_items" ADD CONSTRAINT "purchase_order_receipt_items_warehouse_id_warehouses_id_fk" 
    FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;

-- ==================== TRIGGERS FOR AUDIT TRAIL ====================

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

-- Comments for documentation
COMMENT ON TABLE purchase_order_receipts IS 'Receipts for goods received from suppliers';
COMMENT ON TABLE purchase_order_receipt_items IS 'Individual items received in each receipt';
COMMENT ON COLUMN purchase_order_receipts.status IS 'Receipt status: draft, in_progress, completed, discrepancies, resolved';