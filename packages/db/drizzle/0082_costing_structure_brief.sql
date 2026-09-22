ALTER TABLE "costing_projects"
  ADD COLUMN IF NOT EXISTS "structure_summary" text,
  ADD COLUMN IF NOT EXISTS "design_principles" text;
