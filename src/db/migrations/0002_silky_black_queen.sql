CREATE TABLE "purchase_order_items" (
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
CREATE TABLE "purchase_order_receipt_items" (
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
CREATE TABLE "purchase_order_receipts" (
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
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(100) NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_date" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"shipping_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"payment_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"payment_method" varchar(50),
	"payment_terms" varchar(50) DEFAULT 'NET30',
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"internal_notes" text,
	"reference_number" varchar(100),
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
CREATE TABLE "supplier_purchase_order_items" (
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
	"unit_price" numeric(10, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0',
	"discount_amount" numeric(10, 2) DEFAULT '0',
	"line_total" numeric(12, 2) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0',
	"tax_amount" numeric(10, 2) DEFAULT '0',
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
--> statement-breakpoint
CREATE TABLE "supplier_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" varchar(100) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"order_date" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_delivery_date" timestamp with time zone,
	"requested_delivery_date" timestamp with time zone,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"approval_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"shipping_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "upload_history" (
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
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "expected_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "version" varchar(50) DEFAULT '1.0';--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "parent_price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "original_file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "validation_status" varchar(50) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "validation_errors" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "item_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "currencies_supported" jsonb DEFAULT '["USD"]'::jsonb;--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "phone" varchar(50);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "website" varchar(255);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "address" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "credit_limit" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "tax_id" varchar(50);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "supplier_type" varchar(50) DEFAULT 'vendor';--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "industry" varchar(100);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "performance_rating" numeric(3, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "lead_time_days" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "vendor_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "is_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_receipt_items" ADD CONSTRAINT "purchase_order_receipt_items_receipt_id_purchase_order_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_order_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_receipt_items" ADD CONSTRAINT "purchase_order_receipt_items_supplier_purchase_order_item_id_supplier_purchase_order_items_id_fk" FOREIGN KEY ("supplier_purchase_order_item_id") REFERENCES "public"."supplier_purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_receipts" ADD CONSTRAINT "purchase_order_receipts_supplier_purchase_order_id_supplier_purchase_orders_id_fk" FOREIGN KEY ("supplier_purchase_order_id") REFERENCES "public"."supplier_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_order_items" ADD CONSTRAINT "supplier_purchase_order_items_supplier_purchase_order_id_supplier_purchase_orders_id_fk" FOREIGN KEY ("supplier_purchase_order_id") REFERENCES "public"."supplier_purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_order_items" ADD CONSTRAINT "supplier_purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_order_items" ADD CONSTRAINT "supplier_purchase_order_items_price_list_item_id_price_list_items_id_fk" FOREIGN KEY ("price_list_item_id") REFERENCES "public"."price_list_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_customer_order_id_purchase_orders_id_fk" FOREIGN KEY ("customer_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_history" ADD CONSTRAINT "upload_history_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_history" ADD CONSTRAINT "upload_history_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_items_order_idx" ON "purchase_order_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_product_idx" ON "purchase_order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_sku_idx" ON "purchase_order_items" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "po_receipt_items_receipt_idx" ON "purchase_order_receipt_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "po_receipt_items_supplier_po_item_idx" ON "purchase_order_receipt_items" USING btree ("supplier_purchase_order_item_id");--> statement-breakpoint
CREATE INDEX "po_receipt_items_product_idx" ON "purchase_order_receipt_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "po_receipt_items_sku_idx" ON "purchase_order_receipt_items" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "po_receipt_items_warehouse_idx" ON "purchase_order_receipt_items" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "po_receipts_supplier_po_idx" ON "purchase_order_receipts" USING btree ("supplier_purchase_order_id");--> statement-breakpoint
CREATE INDEX "po_receipts_received_date_idx" ON "purchase_order_receipts" USING btree ("received_date");--> statement-breakpoint
CREATE INDEX "po_receipts_status_idx" ON "purchase_order_receipts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "po_receipts_warehouse_idx" ON "purchase_order_receipts" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "po_receipts_number_idx" ON "purchase_order_receipts" USING btree ("receipt_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_customer_idx" ON "purchase_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_order_date_idx" ON "purchase_orders" USING btree ("order_date");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchase_orders_payment_status_idx" ON "purchase_orders" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "purchase_orders_order_number_idx" ON "purchase_orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_reference_number_idx" ON "purchase_orders" USING btree ("reference_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_created_at_idx" ON "purchase_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_customer_date_idx" ON "purchase_orders" USING btree ("customer_id","order_date");--> statement-breakpoint
CREATE INDEX "purchase_orders_customer_status_idx" ON "purchase_orders" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "supplier_po_items_order_idx" ON "supplier_purchase_order_items" USING btree ("supplier_purchase_order_id");--> statement-breakpoint
CREATE INDEX "supplier_po_items_product_idx" ON "supplier_purchase_order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "supplier_po_items_sku_idx" ON "supplier_purchase_order_items" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "supplier_po_items_status_idx" ON "supplier_purchase_order_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "supplier_po_items_price_list_item_idx" ON "supplier_purchase_order_items" USING btree ("price_list_item_id");--> statement-breakpoint
CREATE INDEX "supplier_po_supplier_idx" ON "supplier_purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_po_order_date_idx" ON "supplier_purchase_orders" USING btree ("order_date");--> statement-breakpoint
CREATE INDEX "supplier_po_status_idx" ON "supplier_purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "supplier_po_approval_status_idx" ON "supplier_purchase_orders" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "supplier_po_number_idx" ON "supplier_purchase_orders" USING btree ("po_number");--> statement-breakpoint
CREATE INDEX "supplier_po_expected_delivery_idx" ON "supplier_purchase_orders" USING btree ("expected_delivery_date");--> statement-breakpoint
CREATE INDEX "supplier_po_created_at_idx" ON "supplier_purchase_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "supplier_po_supplier_status_idx" ON "supplier_purchase_orders" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "supplier_po_price_list_idx" ON "supplier_purchase_orders" USING btree ("price_list_id");--> statement-breakpoint
CREATE INDEX "upload_history_supplier_idx" ON "upload_history" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "upload_history_status_idx" ON "upload_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "upload_history_upload_date_idx" ON "upload_history" USING btree ("upload_date");--> statement-breakpoint
CREATE INDEX "upload_history_uploaded_by_idx" ON "upload_history" USING btree ("uploaded_by");--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_parent_price_list_id_price_lists_id_fk" FOREIGN KEY ("parent_price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_list_version_idx" ON "price_lists" USING btree ("version");--> statement-breakpoint
CREATE INDEX "price_list_validation_idx" ON "price_lists" USING btree ("validation_status");--> statement-breakpoint
CREATE INDEX "price_list_parent_idx" ON "price_lists" USING btree ("parent_price_list_id");--> statement-breakpoint
CREATE INDEX "supplier_type_idx" ON "suppliers" USING btree ("supplier_type");--> statement-breakpoint
CREATE INDEX "supplier_industry_idx" ON "suppliers" USING btree ("industry");--> statement-breakpoint
CREATE INDEX "supplier_performance_idx" ON "suppliers" USING btree ("performance_rating");--> statement-breakpoint
CREATE INDEX "supplier_approved_idx" ON "suppliers" USING btree ("is_approved");