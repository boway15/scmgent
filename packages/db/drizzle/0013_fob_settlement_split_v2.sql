-- FOB split v2: service providers, batch type, merchant payment status
-- Purge historical FOB transactional data (per PRD; fee rules retained)

DELETE FROM "fob_settlement_adjustments";
DELETE FROM "fob_settlement_allocations";
DELETE FROM "fob_container_merchant_stats";
DELETE FROM "fob_merchant_shipments";
DELETE FROM "fob_trucking_bill_items";
DELETE FROM "fob_freight_bill_items";
DELETE FROM "fob_settlement_batches";
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_settlement_type" AS ENUM('trucking', 'freight');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_provider_type" AS ENUM('trucking', 'freight');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_bill_format" AS ENUM('senwei_original', 'huamao_original', 'simplified_wide');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_payment_status" AS ENUM('paid', 'unpaid', 'not_required');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_service_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"provider_type" "fob_provider_type" NOT NULL,
	"bill_format" "fob_bill_format" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fob_service_providers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_service_providers_type_active_idx" ON "fob_service_providers" ("provider_type", "is_active");
--> statement-breakpoint
INSERT INTO "fob_service_providers" ("code", "name", "provider_type", "bill_format", "sort_order", "is_active")
VALUES
  ('senwei', '森威', 'trucking', 'senwei_original', 10, true),
  ('huamao', '华贸', 'freight', 'huamao_original', 10, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "fob_settlement_batches" ADD COLUMN IF NOT EXISTS "settlement_type" "fob_settlement_type";
--> statement-breakpoint
ALTER TABLE "fob_settlement_batches" ADD COLUMN IF NOT EXISTS "service_provider_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_batches" ADD CONSTRAINT "fob_settlement_batches_service_provider_id_fob_service_providers_id_fk" FOREIGN KEY ("service_provider_id") REFERENCES "public"."fob_service_providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "fob_settlement_batches" ALTER COLUMN "settlement_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_settlement_batches" ALTER COLUMN "service_provider_id" SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_merchant_payment_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"merchant_code" varchar(100) NOT NULL,
	"payment_status" "fob_payment_status" DEFAULT 'unpaid' NOT NULL,
	"remark" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fob_merchant_payment_status_batch_merchant_uq" ON "fob_merchant_payment_status" ("batch_id", "merchant_code");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_merchant_payment_status" ADD CONSTRAINT "fob_merchant_payment_status_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_merchant_payment_status" ADD CONSTRAINT "fob_merchant_payment_status_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
