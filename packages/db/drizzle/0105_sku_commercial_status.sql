-- ERP 商业状态（停售/下架）与销量 lifecycle 分离
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "commercial_status" varchar(50);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "commercial_status_norm" varchar(30);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "commercial_status_source" varchar(20);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "commercial_status_at" timestamp with time zone;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "commercial_status_locked" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "skus_commercial_status_norm_idx"
  ON "skus" ("commercial_status_norm")
  WHERE "is_active" = true;
