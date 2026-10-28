-- 商品主数据项目组改为品类路径中间段（事业部\项目组\品类），不再只保留「项目N组」。
-- 现网中间段最长 24 字，varchar(20) 放不下。
ALTER TABLE "skus" ALTER COLUMN "project_group" TYPE varchar(200);
--> statement-breakpoint
ALTER TABLE "demand_plan_versions" ALTER COLUMN "project_group" TYPE varchar(200);
--> statement-breakpoint
ALTER TABLE "planning_demand_adoptions" ALTER COLUMN "project_group" TYPE varchar(200);
--> statement-breakpoint
UPDATE "skus" AS s
SET "project_group" = sub.middle
FROM (
  SELECT
    id,
    CASE
      WHEN cardinality(segs) < 3 THEN NULL
      ELSE nullif(array_to_string(segs[2:cardinality(segs) - 1], E'\\'), '')
    END AS middle
  FROM (
    SELECT
      id,
      ARRAY(
        SELECT btrim(x)
        FROM unnest(
          regexp_split_to_array(replace(btrim(coalesce(category, '')), E'\\', '/'), '/')
        ) AS x
        WHERE btrim(x) <> ''
      ) AS segs
    FROM "skus"
  ) AS parts
) AS sub
WHERE s.id = sub.id
  AND s.project_group IS DISTINCT FROM sub.middle;
