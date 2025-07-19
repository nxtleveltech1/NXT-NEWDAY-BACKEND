-- Migration 0001: Unified Supplier Module Enhancement
-- Adds missing upload_history table and enhances supplier schema for vendor consolidation

-- Step 1: Add missing upload_history table
CREATE TABLE IF NOT EXISTS "upload_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_type" varchar(50) NOT NULL,
	"file_size" integer NOT NULL,
	"status" varchar(50) NOT NULL,
	"item_count" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"errors" jsonb DEFAULT '[]'::jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb,
	"upload_date" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"uploaded_by" uuid NOT NULL,
	"price_list_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Step 2: Add foreign key relationships for upload_history
DO $$ BEGIN
 ALTER TABLE "upload_history" ADD CONSTRAINT "upload_history_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "upload_history" ADD CONSTRAINT "upload_history_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Step 3: Add indexes for upload_history table
CREATE INDEX IF NOT EXISTS "upload_history_supplier_idx" ON "upload_history" USING btree ("supplier_id");
CREATE INDEX IF NOT EXISTS "upload_history_status_idx" ON "upload_history" USING btree ("status");
CREATE INDEX IF NOT EXISTS "upload_history_upload_date_idx" ON "upload_history" USING btree ("upload_date");
CREATE INDEX IF NOT EXISTS "upload_history_uploaded_by_idx" ON "upload_history" USING btree ("uploaded_by");

-- Step 4: Enhance suppliers table with vendor consolidation fields
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "phone" varchar(50);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "website" varchar(255);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "address" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "credit_limit" numeric(12, 2);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "tax_id" varchar(50);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "supplier_type" varchar(50) DEFAULT 'vendor';
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "industry" varchar(100);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "performance_rating" numeric(3, 2) DEFAULT '0';
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "lead_time_days" integer DEFAULT 0;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "vendor_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_approved" boolean DEFAULT false NOT NULL;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "approved_by" uuid;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

-- Step 5: Add new indexes for supplier enhancements
CREATE INDEX IF NOT EXISTS "supplier_type_idx" ON "suppliers" USING btree ("supplier_type");
CREATE INDEX IF NOT EXISTS "supplier_industry_idx" ON "suppliers" USING btree ("industry");
CREATE INDEX IF NOT EXISTS "supplier_performance_idx" ON "suppliers" USING btree ("performance_rating");
CREATE INDEX IF NOT EXISTS "supplier_approved_idx" ON "suppliers" USING btree ("is_approved");

-- Step 6: Enhance price_lists table with version control and validation
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "version" varchar(50) DEFAULT '1.0';
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "parent_price_list_id" uuid;
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "original_file_name" varchar(255);
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "validation_status" varchar(50) DEFAULT 'pending';
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "validation_errors" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "approved_by" uuid;
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "item_count" integer DEFAULT 0;
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "currencies_supported" jsonb DEFAULT '["USD"]'::jsonb;
ALTER TABLE "price_lists" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

-- Step 7: Add foreign key for price_lists parent relationship
DO $$ BEGIN
 ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_parent_price_list_id_price_lists_id_fk" FOREIGN KEY ("parent_price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Step 8: Add new indexes for price_lists enhancements
CREATE INDEX IF NOT EXISTS "price_list_version_idx" ON "price_lists" USING btree ("version");
CREATE INDEX IF NOT EXISTS "price_list_validation_idx" ON "price_lists" USING btree ("validation_status");
CREATE INDEX IF NOT EXISTS "price_list_parent_idx" ON "price_lists" USING btree ("parent_price_list_id");

-- Step 9: Create function to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Step 10: Create triggers for auto-updating updated_at columns
DROP TRIGGER IF EXISTS update_suppliers_updated_at ON suppliers;
CREATE TRIGGER update_suppliers_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_price_lists_updated_at ON price_lists;
CREATE TRIGGER update_price_lists_updated_at
    BEFORE UPDATE ON price_lists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_upload_history_updated_at ON upload_history;
CREATE TRIGGER update_upload_history_updated_at
    BEFORE UPDATE ON upload_history
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Step 11: Insert supported currencies constraint check
ALTER TABLE "price_list_items" DROP CONSTRAINT IF EXISTS "price_list_items_currency_check";
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_currency_check" 
    CHECK (currency IN ('USD', 'EUR', 'GBP', 'ZAR'));

-- Step 12: Add validation status constraint
ALTER TABLE "price_lists" DROP CONSTRAINT IF EXISTS "price_lists_validation_status_check";
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_validation_status_check" 
    CHECK (validation_status IN ('pending', 'validated', 'failed'));

-- Step 13: Add supplier type constraint
ALTER TABLE "suppliers" DROP CONSTRAINT IF EXISTS "suppliers_supplier_type_check";
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_supplier_type_check" 
    CHECK (supplier_type IN ('vendor', 'manufacturer', 'distributor', 'service_provider'));

-- Step 14: Add status constraint for upload_history
ALTER TABLE "upload_history" DROP CONSTRAINT IF EXISTS "upload_history_status_check";
ALTER TABLE "upload_history" ADD CONSTRAINT "upload_history_status_check" 
    CHECK (status IN ('processing', 'completed', 'failed', 'queued', 'cancelled'));

-- Migration complete
INSERT INTO schema_migrations (version, applied_at) 
VALUES ('0001_unified_supplier_module', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;