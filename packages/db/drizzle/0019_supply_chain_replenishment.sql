-- 供应链周期与补货健康度（阶段一）

DO $$ BEGIN
  CREATE TYPE "inventory_health" AS ENUM ('red', 'yellow', 'healthy', 'overstock');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "production_lead_days" integer DEFAULT 50 NOT NULL;

ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "shipping_lead_days" integer;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "inbound_buffer_days" integer DEFAULT 7 NOT NULL;

UPDATE "warehouses" SET "shipping_lead_days" = 45, "inbound_buffer_days" = 7 WHERE "code" = 'US-WEST' AND "shipping_lead_days" IS NULL;
UPDATE "warehouses" SET "shipping_lead_days" = 60, "inbound_buffer_days" = 7 WHERE "code" IN ('US-EAST', 'US-SOUTH', 'US-SOUTHEAST') AND "shipping_lead_days" IS NULL;
UPDATE "warehouses" SET "shipping_lead_days" = 80, "inbound_buffer_days" = 7 WHERE "code" = 'DE' AND "shipping_lead_days" IS NULL;
UPDATE "warehouses" SET "shipping_lead_days" = 75, "inbound_buffer_days" = 7 WHERE "code" = 'UK' AND "shipping_lead_days" IS NULL;

ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "safety_stock_days" integer DEFAULT 14;
ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "target_coverage_days" integer;
ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "overstock_threshold_days" integer DEFAULT 180;

ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "health_status" "inventory_health";
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "coverage_days" numeric(10, 2);
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "total_lead_days" integer;
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "latest_order_days" numeric(10, 2);
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "metrics" jsonb;

CREATE TABLE IF NOT EXISTS "purchase_follow_up_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" uuid NOT NULL REFERENCES "purchase_drafts"("id") ON DELETE CASCADE,
  "milestone" varchar(10) NOT NULL,
  "due_date" date NOT NULL,
  "notified_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_follow_up_reminders_draft_milestone_idx"
  ON "purchase_follow_up_reminders" ("draft_id", "milestone");
