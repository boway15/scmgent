ALTER TABLE "costing_projects"
  ADD COLUMN IF NOT EXISTS "carcass_thickness_mm" integer,
  ADD COLUMN IF NOT EXISTS "drawer_bottom_thickness_mm" integer,
  ADD COLUMN IF NOT EXISTS "hardware_facts" jsonb,
  ADD COLUMN IF NOT EXISTS "cost_computed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "cost_summary" jsonb;
