ALTER TABLE "costing_factories"
  ADD COLUMN IF NOT EXISTS "pack_profile" jsonb;
