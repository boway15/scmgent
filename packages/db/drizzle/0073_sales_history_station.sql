ALTER TABLE "sales_history" ADD COLUMN IF NOT EXISTS "station" varchar(20) DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_history_station_idx" ON "sales_history" ("station");
--> statement-breakpoint
-- Best-effort backfill from category path (report 站点 was never persisted).
-- UK rarely appears in category; full UK fidelity still needs re-import of source files.
UPDATE "sales_history"
SET "station" = 'UK'
WHERE COALESCE(TRIM("station"), '') = ''
  AND (
    "category" ILIKE '%英国%'
    OR "category" ~* '(^|[\\/\\-_[:space:]])UK([\\/\\-_[:space:]]|$)'
  );
--> statement-breakpoint
UPDATE "sales_history"
SET "station" = 'EU'
WHERE COALESCE(TRIM("station"), '') = ''
  AND (
    "category" ILIKE '%德国%'
    OR "category" ILIKE '%-EU%'
    OR "category" ~* '(^|[\\/\\-_[:space:]])(EU|DE)([\\/\\-_[:space:]]|$)'
  );
--> statement-breakpoint
UPDATE "sales_history"
SET "station" = 'US'
WHERE COALESCE(TRIM("station"), '') = ''
  AND (
    "category" ILIKE '%美国%'
    OR "category" ILIKE '%-US%'
    OR "category" ~* '(^|[\\/\\-_[:space:]])US([\\/\\-_[:space:]]|$)'
  );
--> statement-breakpoint
DROP INDEX IF EXISTS "sales_history_sku_date_channel_unique_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_history_sku_date_channel_station_unique_idx"
  ON "sales_history" ("sku_id", "sale_date", "channel", "station");
