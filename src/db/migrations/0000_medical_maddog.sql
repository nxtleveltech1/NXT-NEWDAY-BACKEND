CREATE TABLE "analytics_daily_aggregates" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"dimension" varchar(50) NOT NULL,
	"dimension_id" uuid NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"sales_quantity" integer DEFAULT 0 NOT NULL,
	"sales_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sales_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sales_profit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"avg_order_value" numeric(10, 2),
	"avg_unit_price" numeric(10, 2),
	"avg_discount" numeric(5, 2),
	"inventory_level" integer,
	"inventory_value" numeric(12, 2),
	"stock_turnover" numeric(5, 2),
	"unique_customers" integer DEFAULT 0,
	"new_customers" integer DEFAULT 0,
	"returning_customers" integer DEFAULT 0,
	"conversion_rate" numeric(5, 2),
	"return_rate" numeric(5, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_monthly_aggregates" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"dimension" varchar(50) NOT NULL,
	"dimension_id" uuid NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"sales_quantity" integer DEFAULT 0 NOT NULL,
	"sales_revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sales_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sales_profit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"revenue_growth" numeric(8, 2),
	"quantity_growth" numeric(8, 2),
	"customer_growth" numeric(8, 2),
	"avg_daily_sales" numeric(10, 2),
	"avg_order_value" numeric(10, 2),
	"avg_inventory_level" numeric(10, 2),
	"inventory_turnover" numeric(5, 2),
	"days_of_inventory" integer,
	"total_customers" integer DEFAULT 0,
	"active_customers" integer DEFAULT 0,
	"churned_customers" integer DEFAULT 0,
	"customer_retention" numeric(5, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_code" varchar(50) NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50),
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"purchase_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_customer_code_unique" UNIQUE("customer_code")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid,
	"quantity_on_hand" integer DEFAULT 0 NOT NULL,
	"quantity_available" integer DEFAULT 0 NOT NULL,
	"quantity_reserved" integer DEFAULT 0 NOT NULL,
	"quantity_in_transit" integer DEFAULT 0 NOT NULL,
	"last_stock_check" timestamp with time zone,
	"last_movement" timestamp with time zone,
	"stock_status" varchar(50) DEFAULT 'in_stock' NOT NULL,
	"reorder_point" integer DEFAULT 0,
	"reorder_quantity" integer DEFAULT 0,
	"max_stock_level" integer,
	"min_stock_level" integer DEFAULT 0,
	"average_cost" numeric(10, 2),
	"last_purchase_cost" numeric(10, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_id" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"movement_type" varchar(50) NOT NULL,
	"quantity" integer NOT NULL,
	"from_location" uuid,
	"to_location" uuid,
	"unit_cost" numeric(10, 2),
	"total_cost" numeric(12, 2),
	"reference_type" varchar(50),
	"reference_id" uuid,
	"reference_number" varchar(100),
	"performed_by" uuid,
	"notes" text,
	"batch_number" varchar(100),
	"serial_numbers" jsonb DEFAULT '[]'::jsonb,
	"expiry_date" date,
	"quantity_after" integer NOT NULL,
	"running_total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"sku" varchar(100) NOT NULL,
	"description" text,
	"unit_price" numeric(15, 5) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"min_quantity" integer DEFAULT 1,
	"discount_percent" numeric(5, 2) DEFAULT '0',
	"tier_pricing" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"effective_date" date NOT NULL,
	"expiry_date" date,
	"status" varchar(50) DEFAULT 'draft',
	"upload_format" varchar(50),
	"original_file_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(100),
	"unit_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cost_price" numeric(10, 2) DEFAULT '0',
	"supplier_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_code" varchar(50) NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"contact_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_supplier_code_unique" UNIQUE("supplier_code")
);
--> statement-breakpoint
CREATE TABLE "time_series_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"event_category" varchar(50) NOT NULL,
	"user_id" uuid,
	"session_id" varchar(100),
	"entity_type" varchar(50),
	"entity_id" uuid,
	"action" varchar(100),
	"properties" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"duration" integer,
	"result_status" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_series_hourly_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"hour_timestamp" timestamp with time zone NOT NULL,
	"metric_name" varchar(100) NOT NULL,
	"avg_value" real,
	"min_value" real,
	"max_value" real,
	"sum_value" real,
	"count_value" integer,
	"p50" real,
	"p95" real,
	"p99" real,
	"dimension1" varchar(100),
	"dimension2" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_series_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"metric_name" varchar(100) NOT NULL,
	"metric_type" varchar(50) NOT NULL,
	"dimension1" varchar(100),
	"dimension2" varchar(100),
	"dimension3" varchar(100),
	"value" real NOT NULL,
	"count" integer DEFAULT 1,
	"sum" real,
	"min" real,
	"max" real,
	"tags" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_daily_date_dim_idx" ON "analytics_daily_aggregates" USING btree ("date","dimension","dimension_id");--> statement-breakpoint
CREATE INDEX "analytics_daily_dimension_idx" ON "analytics_daily_aggregates" USING btree ("dimension");--> statement-breakpoint
CREATE INDEX "analytics_daily_date_idx" ON "analytics_daily_aggregates" USING btree ("date");--> statement-breakpoint
CREATE INDEX "analytics_monthly_ym_dim_idx" ON "analytics_monthly_aggregates" USING btree ("year","month","dimension","dimension_id");--> statement-breakpoint
CREATE INDEX "analytics_monthly_ym_idx" ON "analytics_monthly_aggregates" USING btree ("year","month");--> statement-breakpoint
CREATE INDEX "customer_code_idx" ON "customers" USING btree ("customer_code");--> statement-breakpoint
CREATE INDEX "customer_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customer_company_idx" ON "customers" USING btree ("company_name");--> statement-breakpoint
CREATE INDEX "customer_created_idx" ON "customers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inventory_product_warehouse_idx" ON "inventory" USING btree ("product_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_status_idx" ON "inventory" USING btree ("stock_status");--> statement-breakpoint
CREATE INDEX "inventory_reorder_point_idx" ON "inventory" USING btree ("reorder_point");--> statement-breakpoint
CREATE INDEX "inventory_last_movement_idx" ON "inventory" USING btree ("last_movement");--> statement-breakpoint
CREATE INDEX "movement_inventory_idx" ON "inventory_movements" USING btree ("inventory_id");--> statement-breakpoint
CREATE INDEX "movement_product_idx" ON "inventory_movements" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "movement_warehouse_idx" ON "inventory_movements" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "movement_type_idx" ON "inventory_movements" USING btree ("movement_type");--> statement-breakpoint
CREATE INDEX "movement_created_idx" ON "inventory_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "movement_reference_idx" ON "inventory_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "price_item_list_idx" ON "price_list_items" USING btree ("price_list_id");--> statement-breakpoint
CREATE INDEX "price_item_sku_idx" ON "price_list_items" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "price_item_list_sku_idx" ON "price_list_items" USING btree ("price_list_id","sku");--> statement-breakpoint
CREATE INDEX "price_item_min_qty_idx" ON "price_list_items" USING btree ("min_quantity");--> statement-breakpoint
CREATE INDEX "price_list_supplier_idx" ON "price_lists" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "price_list_status_idx" ON "price_lists" USING btree ("status");--> statement-breakpoint
CREATE INDEX "price_list_effective_idx" ON "price_lists" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "price_list_supplier_status_idx" ON "price_lists" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "product_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "product_name_idx" ON "products" USING btree ("name");--> statement-breakpoint
CREATE INDEX "product_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "product_supplier_idx" ON "products" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "product_active_idx" ON "products" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "supplier_code_idx" ON "suppliers" USING btree ("supplier_code");--> statement-breakpoint
CREATE INDEX "supplier_company_idx" ON "suppliers" USING btree ("company_name");--> statement-breakpoint
CREATE INDEX "supplier_email_idx" ON "suppliers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "supplier_active_idx" ON "suppliers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "ts_events_timestamp_event_idx" ON "time_series_events" USING btree ("timestamp","event_type");--> statement-breakpoint
CREATE INDEX "ts_events_type_idx" ON "time_series_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "ts_events_user_idx" ON "time_series_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ts_events_entity_idx" ON "time_series_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ts_hourly_hour_metric_dim_idx" ON "time_series_hourly_metrics" USING btree ("hour_timestamp","metric_name","dimension1","dimension2");--> statement-breakpoint
CREATE INDEX "ts_metrics_timestamp_metric_idx" ON "time_series_metrics" USING btree ("timestamp","metric_name");--> statement-breakpoint
CREATE INDEX "ts_metrics_name_idx" ON "time_series_metrics" USING btree ("metric_name");--> statement-breakpoint
CREATE INDEX "ts_metrics_dim1_idx" ON "time_series_metrics" USING btree ("dimension1");--> statement-breakpoint
CREATE INDEX "ts_metrics_created_idx" ON "time_series_metrics" USING btree ("created_at");