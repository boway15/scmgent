DO $$ BEGIN
 CREATE TYPE "public"."fob_settlement_status" AS ENUM('draft', 'imported', 'calculated', 'confirmed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_cost_stage" AS ENUM('trucking', 'freight', 'customs', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_settlement_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_no" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"settlement_period" varchar(7) NOT NULL,
	"usd_to_cny_rate" numeric(10, 4) DEFAULT '7.25' NOT NULL,
	"status" "fob_settlement_status" DEFAULT 'draft' NOT NULL,
	"remark" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fob_settlement_batches_batch_no_unique" UNIQUE("batch_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_merchant_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"merchant_code" varchar(100) NOT NULL,
	"merchant_name" varchar(200),
	"container_no" varchar(50) NOT NULL,
	"sku_code" varchar(100),
	"qty" integer,
	"volume_cbm" numeric(12, 4) NOT NULL,
	"weight_kg" numeric(12, 3),
	"remark" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_trucking_bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"container_no" varchar(50) NOT NULL,
	"internal_no" varchar(100),
	"bl_no" varchar(100),
	"ship_date" varchar(50),
	"load_address" text,
	"fee_type" varchar(100) NOT NULL,
	"amount_cny" numeric(14, 2) NOT NULL,
	"source_row" integer,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_freight_bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"container_no" varchar(50) NOT NULL,
	"order_no" varchar(100),
	"bl_no" varchar(100),
	"biz_date" varchar(50),
	"dest_port" varchar(50),
	"volume_cbm" numeric(12, 4),
	"fee_type" varchar(100) NOT NULL,
	"stage" "fob_cost_stage" DEFAULT 'freight' NOT NULL,
	"amount_cny" numeric(14, 2) NOT NULL,
	"original_currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"original_amount" numeric(14, 2),
	"exchange_rate" numeric(10, 4),
	"source_row" integer,
	"panel_side" varchar(10),
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_settlement_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"container_no" varchar(50) NOT NULL,
	"merchant_code" varchar(100) NOT NULL,
	"merchant_name" varchar(200),
	"stage" "fob_cost_stage" NOT NULL,
	"fee_type" varchar(100) NOT NULL,
	"source_bill_type" varchar(20) NOT NULL,
	"source_ref" varchar(200),
	"source_amount_cny" numeric(14, 2) NOT NULL,
	"merchant_volume_cbm" numeric(12, 4) NOT NULL,
	"volume_ratio" numeric(10, 6) NOT NULL,
	"allocated_amount_cny" numeric(14, 2) NOT NULL,
	"is_tail_adjustment" boolean DEFAULT false NOT NULL,
	"calc_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_batches" ADD CONSTRAINT "fob_settlement_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_merchant_shipments" ADD CONSTRAINT "fob_merchant_shipments_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_trucking_bill_items" ADD CONSTRAINT "fob_trucking_bill_items_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_freight_bill_items" ADD CONSTRAINT "fob_freight_bill_items_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_allocations" ADD CONSTRAINT "fob_settlement_allocations_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_settlement_batches_period_idx" ON "fob_settlement_batches" USING btree ("settlement_period","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_merchant_shipments_batch_container_idx" ON "fob_merchant_shipments" USING btree ("batch_id","container_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_trucking_bill_items_batch_container_idx" ON "fob_trucking_bill_items" USING btree ("batch_id","container_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_freight_bill_items_batch_container_idx" ON "fob_freight_bill_items" USING btree ("batch_id","container_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_settlement_allocations_batch_merchant_idx" ON "fob_settlement_allocations" USING btree ("batch_id","merchant_code");
