ALTER TABLE "purchase_drafts"
  ADD COLUMN IF NOT EXISTS "planned_production_done_date" date,
  ADD COLUMN IF NOT EXISTS "actual_production_done_date" date,
  ADD COLUMN IF NOT EXISTS "planned_pickup_date" date,
  ADD COLUMN IF NOT EXISTS "etd" date,
  ADD COLUMN IF NOT EXISTS "eta_port" date,
  ADD COLUMN IF NOT EXISTS "customs_done_date" date,
  ADD COLUMN IF NOT EXISTS "eta_warehouse" date,
  ADD COLUMN IF NOT EXISTS "transport_mode" varchar(50);
