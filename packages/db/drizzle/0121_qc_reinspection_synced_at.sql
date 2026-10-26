ALTER TABLE "qc_reinspection_rows" ADD COLUMN IF NOT EXISTS "synced_at" timestamptz;
UPDATE "qc_reinspection_rows" SET "synced_at" = "inserted_at" WHERE "synced_at" IS NULL;
ALTER TABLE "qc_reinspection_rows" ALTER COLUMN "synced_at" SET NOT NULL;
