-- SKU 主数据：从品类路径第二段派生的项目组（如 项目1组）
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "project_group" varchar(20);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skus_project_group_idx" ON "skus" ("project_group");
--> statement-breakpoint
UPDATE "skus"
SET "project_group" = (
  SELECT (regexp_match(
    split_part(replace(coalesce("category", ''), E'\\', '/'), '/', 2),
    '项目[0-9]+组'
  ))[1]
)
WHERE "category" IS NOT NULL AND btrim("category") <> '';
