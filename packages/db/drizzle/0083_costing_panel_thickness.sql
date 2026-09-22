ALTER TABLE "costing_projects"
  ADD COLUMN IF NOT EXISTS "side_thickness_mm" integer,
  ADD COLUMN IF NOT EXISTS "back_thickness_mm" integer,
  ADD COLUMN IF NOT EXISTS "bottom_thickness_mm" integer;
