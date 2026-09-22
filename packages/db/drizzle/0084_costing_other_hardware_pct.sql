ALTER TABLE "costing_projects"
  ADD COLUMN IF NOT EXISTS "other_hardware_pct" numeric(6, 2);
