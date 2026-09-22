ALTER TABLE "costing_bom_lines"
  ADD COLUMN IF NOT EXISTS "process_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb;
