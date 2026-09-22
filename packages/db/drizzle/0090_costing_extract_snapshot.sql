ALTER TABLE "costing_bom_lines"
  ADD COLUMN IF NOT EXISTS "extract_snapshot" jsonb;
