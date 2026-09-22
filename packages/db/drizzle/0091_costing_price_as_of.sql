ALTER TABLE "costing_projects"
  ADD COLUMN IF NOT EXISTS "price_as_of" date NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE "material_price_book"
  ADD COLUMN IF NOT EXISTS "effective_from" date NOT NULL DEFAULT '2000-01-01',
  ADD COLUMN IF NOT EXISTS "effective_to" date;
