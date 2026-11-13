ALTER TABLE "inventory_sales_cube_rows"
  ADD COLUMN IF NOT EXISTS "qty_domestic_unshipped" integer DEFAULT 0 NOT NULL;
