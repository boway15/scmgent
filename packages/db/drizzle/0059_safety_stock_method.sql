DO $$ BEGIN
 CREATE TYPE "public"."safety_stock_method" AS ENUM('coverage_days', 'z_demand', 'z_demand_leadtime');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "safety_stock_method" "safety_stock_method" DEFAULT 'coverage_days' NOT NULL;
--> statement-breakpoint
ALTER TABLE "safety_stock_config" ALTER COLUMN "service_level" TYPE numeric(4, 3);
--> statement-breakpoint
ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "demand_std_dev" numeric;
--> statement-breakpoint
ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "lead_time_std_dev" numeric;
