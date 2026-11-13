-- M1 产品成本核算：0075 将 bom_* 收成 ready，此迁移恢复 workflow 状态值
ALTER TYPE "public"."costing_project_status" ADD VALUE IF NOT EXISTS 'bom_draft';
--> statement-breakpoint
ALTER TYPE "public"."costing_project_status" ADD VALUE IF NOT EXISTS 'bom_ready';
--> statement-breakpoint
ALTER TYPE "public"."costing_project_status" ADD VALUE IF NOT EXISTS 'costed';
--> statement-breakpoint
UPDATE "costing_projects"
SET "status" = 'bom_ready'
WHERE "status"::text = 'ready';
