ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "external_version" varchar(50);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "sync_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "external_version" varchar(50);
--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "sync_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "external_version" varchar(50);
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "sync_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "external_version" varchar(50);
--> statement-breakpoint
ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "sync_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "external_version" varchar(50);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "sync_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "lead_time_profiles" ADD COLUMN IF NOT EXISTS "external_version" varchar(50);
--> statement-breakpoint
ALTER TABLE "lead_time_profiles" ADD COLUMN IF NOT EXISTS "sync_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "lead_time_profiles" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp with time zone;
