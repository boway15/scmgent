CREATE TABLE IF NOT EXISTS "procurement_ops_snapshot_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_date" date NOT NULL,
  "synced_at" timestamptz DEFAULT now() NOT NULL,
  "source" varchar(50) DEFAULT 'feishu-bitable' NOT NULL,
  "status" varchar(20) DEFAULT 'published' NOT NULL,
  "row_count" integer NOT NULL,
  "columns" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "procurement_ops_daily_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "snapshot_date" date NOT NULL,
  "sku_id" uuid,
  "sku_code" varchar(100) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "procurement_ops_daily_snapshots"
 ADD CONSTRAINT "procurement_ops_daily_snapshots_run_id_procurement_ops_snapshot_runs_id_fk"
 FOREIGN KEY ("run_id") REFERENCES "public"."procurement_ops_snapshot_runs"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "procurement_ops_daily_snapshots"
 ADD CONSTRAINT "procurement_ops_daily_snapshots_sku_id_skus_id_fk"
 FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "procurement_ops_daily_snapshots_date_sku_code_idx"
ON "procurement_ops_daily_snapshots" ("snapshot_date", "sku_code");

CREATE INDEX IF NOT EXISTS "procurement_ops_daily_snapshots_sku_code_date_idx"
ON "procurement_ops_daily_snapshots" ("sku_code", "snapshot_date");

CREATE INDEX IF NOT EXISTS "procurement_ops_daily_snapshots_run_id_idx"
ON "procurement_ops_daily_snapshots" ("run_id");

CREATE INDEX IF NOT EXISTS "procurement_ops_snapshot_runs_date_status_idx"
ON "procurement_ops_snapshot_runs" ("snapshot_date", "status");
