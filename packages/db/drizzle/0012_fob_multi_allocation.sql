DO $$ BEGIN
 ALTER TYPE "public"."fob_settlement_status" ADD VALUE IF NOT EXISTS 'reviewed' BEFORE 'calculated';
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_allocation_method" AS ENUM('by_volume', 'by_ticket', 'fixed', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_exception_status" AS ENUM('pending', 'confirmed', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_adjust_type" AS ENUM('amount', 'merchant', 'exclude', 'ticket_count');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_fee_allocation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_type" varchar(100),
	"source_bill_type" varchar(20) NOT NULL,
	"match_pattern" varchar(100),
	"allocation_method" "fob_allocation_method" NOT NULL,
	"default_stage" "fob_cost_stage" DEFAULT 'other' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_container_merchant_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"container_no" varchar(50) NOT NULL,
	"merchant_code" varchar(100) NOT NULL,
	"merchant_name" varchar(200),
	"volume_cbm" numeric(12, 4) NOT NULL,
	"ticket_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_settlement_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"allocation_id" uuid,
	"bill_item_id" uuid,
	"bill_item_type" varchar(20),
	"adjust_type" "fob_adjust_type" NOT NULL,
	"original_value" text,
	"adjusted_value" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "allocation_method" "fob_allocation_method";
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "is_exception" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "exception_status" "fob_exception_status";
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "assigned_merchant_code" varchar(100);
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "adjusted_amount_cny" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "review_note" text;
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "reviewed_by" uuid;
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "allocation_method" "fob_allocation_method";
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "is_exception" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "exception_status" "fob_exception_status";
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "assigned_merchant_code" varchar(100);
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "adjusted_amount_cny" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "review_note" text;
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "reviewed_by" uuid;
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "source_bill_item_id" uuid;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "allocation_method" "fob_allocation_method" DEFAULT 'by_volume' NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "ticket_count" integer;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "ticket_ratio" numeric(10, 6);
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "is_manual_override" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "override_reason" text;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ALTER COLUMN "merchant_volume_cbm" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ALTER COLUMN "volume_ratio" SET DEFAULT '0';
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_container_merchant_stats" ADD CONSTRAINT "fob_container_merchant_stats_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_adjustments" ADD CONSTRAINT "fob_settlement_adjustments_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_adjustments" ADD CONSTRAINT "fob_settlement_adjustments_allocation_id_fob_settlement_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."fob_settlement_allocations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_adjustments" ADD CONSTRAINT "fob_settlement_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_trucking_bill_items" ADD CONSTRAINT "fob_trucking_bill_items_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_freight_bill_items" ADD CONSTRAINT "fob_freight_bill_items_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_fee_allocation_rules_bill_type_idx" ON "fob_fee_allocation_rules" USING btree ("source_bill_type","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fob_container_merchant_stats_uq" ON "fob_container_merchant_stats" USING btree ("batch_id","container_no","merchant_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_settlement_adjustments_batch_idx" ON "fob_settlement_adjustments" USING btree ("batch_id");
