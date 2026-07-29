ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "source_system" varchar(50);
--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "external_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "source_system" varchar(50);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "external_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "source_system" varchar(50);
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "external_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "source_system" varchar(50);
--> statement-breakpoint
ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "external_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "pmc_plan_items" ADD COLUMN IF NOT EXISTS "external_line_id" varchar(100);
