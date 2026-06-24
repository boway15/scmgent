-- 库存健康快照、异常处置、补货/预警幂等字段

DO $$ BEGIN
  CREATE TYPE "inventory_exception_type" AS ENUM('stockout', 'overstock', 'slow_moving', 'lifecycle_eol');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "inventory_exception_status" AS ENUM('open', 'in_progress', 'resolved', 'dismissed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "inventory_health_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id"),
  "warehouse_code" varchar(100) NOT NULL,
  "health_status" "inventory_health" NOT NULL,
  "coverage_days" numeric(10, 2),
  "effective_qty" integer NOT NULL DEFAULT 0,
  "avg_daily" numeric(12, 4) NOT NULL DEFAULT 0,
  "demand_source" varchar(20) NOT NULL DEFAULT 'historical',
  "total_lead_days" integer,
  "latest_order_days" numeric(10, 2),
  "metrics" jsonb,
  "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "run_id" uuid
);

CREATE INDEX IF NOT EXISTS "inventory_health_snapshots_sku_wh_idx"
  ON "inventory_health_snapshots" ("sku_id", "warehouse_code", "computed_at" DESC);

CREATE INDEX IF NOT EXISTS "inventory_health_snapshots_health_idx"
  ON "inventory_health_snapshots" ("health_status", "computed_at" DESC);

CREATE TABLE IF NOT EXISTS "inventory_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id"),
  "warehouse_code" varchar(100) NOT NULL,
  "exception_type" "inventory_exception_type" NOT NULL,
  "health_status" "inventory_health" NOT NULL,
  "recommended_action" text,
  "status" "inventory_exception_status" NOT NULL DEFAULT 'open',
  "owner_id" uuid REFERENCES "users"("id"),
  "due_date" date,
  "resolved_by" uuid REFERENCES "users"("id"),
  "resolved_at" timestamp with time zone,
  "resolution_note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "inventory_exceptions_status_idx"
  ON "inventory_exceptions" ("status", "due_date");

CREATE INDEX IF NOT EXISTS "inventory_exceptions_sku_wh_type_idx"
  ON "inventory_exceptions" ("sku_id", "warehouse_code", "exception_type", "status");

ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;

ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "resolved_by" uuid REFERENCES "users"("id");
