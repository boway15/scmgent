ALTER TABLE "sales_history" ADD COLUMN IF NOT EXISTS "category" varchar(200);
ALTER TABLE "sales_history_monthly" ADD COLUMN IF NOT EXISTS "category" varchar(200);

CREATE INDEX IF NOT EXISTS "sales_history_category_idx" ON "sales_history" ("category");

UPDATE "sales_history" sh
SET "category" = s."category"
FROM "skus" s
WHERE sh."sku_id" = s."id"
  AND sh."category" IS NULL
  AND s."category" IS NOT NULL;

UPDATE "sales_history_monthly" shm
SET "category" = s."category"
FROM "skus" s
WHERE shm."sku_id" = s."id"
  AND shm."category" IS NULL
  AND s."category" IS NOT NULL;
