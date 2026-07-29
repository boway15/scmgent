ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "eta_available" date;
UPDATE "purchase_drafts"
SET "eta_available" = "confirmed_delivery_date"
WHERE "eta_available" IS NULL AND "confirmed_delivery_date" IS NOT NULL;
