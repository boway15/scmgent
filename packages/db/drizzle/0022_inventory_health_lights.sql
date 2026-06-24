-- 库存健康灯：蓝/绿/黄/红/灰（替换 healthy/overstock）
CREATE TYPE "inventory_health_new" AS ENUM ('red', 'yellow', 'green', 'blue', 'gray');

ALTER TABLE "reorder_suggestions"
  ALTER COLUMN "health_status" TYPE "inventory_health_new"
  USING (
    CASE "health_status"::text
      WHEN 'healthy' THEN 'green'::inventory_health_new
      WHEN 'overstock' THEN 'blue'::inventory_health_new
      WHEN 'red' THEN 'red'::inventory_health_new
      WHEN 'yellow' THEN 'yellow'::inventory_health_new
      ELSE 'green'::inventory_health_new
    END
  );

DROP TYPE "inventory_health";
ALTER TYPE "inventory_health_new" RENAME TO "inventory_health";
