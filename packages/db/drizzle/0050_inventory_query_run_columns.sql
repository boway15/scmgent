ALTER TABLE "inventory_query_snapshot_runs"
  ADD COLUMN IF NOT EXISTS "columns" jsonb;
