-- Remove unused fob_service_providers.bill_format (import parses by file structure only)
ALTER TABLE "fob_service_providers" DROP COLUMN IF EXISTS "bill_format";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."fob_bill_format";
