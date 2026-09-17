DO $$ BEGIN
  ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'stockout_horizon';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'coverage_short';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'overstock';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'uncoverable_by_new_po';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "horizon_days" integer;
--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "projected_qty" integer;
--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "projected_stockout_date" date;
