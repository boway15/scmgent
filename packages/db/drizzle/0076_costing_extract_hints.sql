ALTER TABLE "costing_projects" ADD COLUMN IF NOT EXISTS "construction_type" varchar(20);
--> statement-breakpoint
ALTER TABLE "costing_projects" ADD COLUMN IF NOT EXISTS "drawer_count" integer;
--> statement-breakpoint
ALTER TABLE "costing_projects" ADD COLUMN IF NOT EXISTS "default_substrate" varchar(100);
