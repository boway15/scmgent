ALTER TABLE "inventory_records" ADD COLUMN IF NOT EXISTS "qty_in_production" integer DEFAULT 0;

ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "merchant_code" varchar(100);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "merchant_name" varchar(200);

ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "merchant_code" varchar(100);
ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "merchant_name" varchar(200);
UPDATE "pmc_plans" SET "merchant_code" = 'UNKNOWN' WHERE "merchant_code" IS NULL;
ALTER TABLE "pmc_plans" ALTER COLUMN "merchant_code" SET NOT NULL;

ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "plan_id" uuid;
DO $$ BEGIN
 ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_plan_id_pmc_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pmc_plans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
