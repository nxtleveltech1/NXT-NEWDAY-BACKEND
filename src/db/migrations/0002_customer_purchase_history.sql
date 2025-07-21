-- Migration: Create dedicated purchase orders and purchase order items tables
-- for better purchase history tracking

CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(100) NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_date" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL, -- pending, confirmed, shipped, delivered, cancelled
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"shipping_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"payment_status" varchar(50) DEFAULT 'pending' NOT NULL, -- pending, paid, partial, failed
	"payment_method" varchar(50),
	"payment_terms" varchar(50) DEFAULT 'NET30',
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"internal_notes" text,
	"reference_number" varchar(100), -- Customer's PO number
	"created_by" uuid,
	"processed_by" uuid,
	"shipped_date" timestamp with time zone,
	"delivered_date" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_order_number_unique" UNIQUE("order_number")
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" varchar(100) NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0',
	"discount_amount" numeric(10, 2) DEFAULT '0',
	"line_total" numeric(12, 2) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0',
	"tax_amount" numeric(10, 2) DEFAULT '0',
	"warehouse_id" uuid,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- Add foreign key constraints
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "purchase_orders_customer_idx" ON "purchase_orders" USING btree ("customer_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_order_date_idx" ON "purchase_orders" USING btree ("order_date");
CREATE INDEX IF NOT EXISTS "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status");
CREATE INDEX IF NOT EXISTS "purchase_orders_payment_status_idx" ON "purchase_orders" USING btree ("payment_status");
CREATE INDEX IF NOT EXISTS "purchase_orders_order_number_idx" ON "purchase_orders" USING btree ("order_number");
CREATE INDEX IF NOT EXISTS "purchase_orders_reference_number_idx" ON "purchase_orders" USING btree ("reference_number");
CREATE INDEX IF NOT EXISTS "purchase_orders_created_at_idx" ON "purchase_orders" USING btree ("created_at");

CREATE INDEX IF NOT EXISTS "purchase_order_items_order_idx" ON "purchase_order_items" USING btree ("purchase_order_id");
CREATE INDEX IF NOT EXISTS "purchase_order_items_product_idx" ON "purchase_order_items" USING btree ("product_id");
CREATE INDEX IF NOT EXISTS "purchase_order_items_sku_idx" ON "purchase_order_items" USING btree ("sku");

-- Create search indexes for customer purchase history queries
CREATE INDEX IF NOT EXISTS "purchase_orders_customer_date_idx" ON "purchase_orders" USING btree ("customer_id", "order_date");
CREATE INDEX IF NOT EXISTS "purchase_orders_customer_status_idx" ON "purchase_orders" USING btree ("customer_id", "status");