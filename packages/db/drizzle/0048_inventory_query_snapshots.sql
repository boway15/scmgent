CREATE TABLE IF NOT EXISTS "inventory_query_snapshot_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_date" date NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source" varchar(50) DEFAULT 'feishu-bitable' NOT NULL,
  "status" varchar(20) DEFAULT 'published' NOT NULL,
  "row_count" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_query_daily_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "snapshot_date" date NOT NULL,
  "sku_id" uuid,
  "sku_code" varchar(100) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_query_daily_snapshots"
 ADD CONSTRAINT "inventory_query_daily_snapshots_run_id_inventory_query_snapshot_runs_id_fk"
 FOREIGN KEY ("run_id") REFERENCES "public"."inventory_query_snapshot_runs"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_query_daily_snapshots"
 ADD CONSTRAINT "inventory_query_daily_snapshots_sku_id_skus_id_fk"
 FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id")
 ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_query_daily_snapshots_date_sku_code_unique_idx"
ON "inventory_query_daily_snapshots" ("snapshot_date", "sku_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_query_daily_snapshots_sku_code_date_idx"
ON "inventory_query_daily_snapshots" ("sku_code", "snapshot_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_query_daily_snapshots_run_id_idx"
ON "inventory_query_daily_snapshots" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_query_snapshot_runs_date_status_idx"
ON "inventory_query_snapshot_runs" ("snapshot_date", "status");
