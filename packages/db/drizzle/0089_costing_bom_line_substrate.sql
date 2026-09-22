-- 板材行可单独指定材质（颗粒板/密度板等），计价优先于项目默认基材。
ALTER TABLE "costing_bom_lines"
  ADD COLUMN IF NOT EXISTS "substrate" varchar(100);
