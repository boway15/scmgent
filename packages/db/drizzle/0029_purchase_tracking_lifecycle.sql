-- 采购跟单履约闭环：扩展 status 枚举 + 新字段
-- 注意：不在此迁移中将 submitted 改为 confirmed（PG 新枚举值须先提交才能 UPDATE 使用）
-- 应用层 purchase-draft-lifecycle.normalizePurchaseDraftStatus 已将 submitted 视为 confirmed

ALTER TYPE "purchase_draft_status" ADD VALUE IF NOT EXISTS 'confirmed';
--> statement-breakpoint
ALTER TYPE "purchase_draft_status" ADD VALUE IF NOT EXISTS 'in_production';
--> statement-breakpoint
ALTER TYPE "purchase_draft_status" ADD VALUE IF NOT EXISTS 'ready_to_ship';
--> statement-breakpoint
ALTER TYPE "purchase_draft_status" ADD VALUE IF NOT EXISTS 'in_transit';
--> statement-breakpoint
ALTER TYPE "purchase_draft_status" ADD VALUE IF NOT EXISTS 'partial_received';
--> statement-breakpoint
ALTER TYPE "purchase_draft_status" ADD VALUE IF NOT EXISTS 'received';
--> statement-breakpoint
ALTER TYPE "purchase_draft_status" ADD VALUE IF NOT EXISTS 'exception';
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "plan_item_id" uuid REFERENCES "pmc_plan_items"("id");
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "supplier_confirmed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "confirmed_delivery_date" date;
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "actual_ship_date" date;
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "actual_received_date" date;
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "received_qty" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "exception_reason" text;
--> statement-breakpoint
ALTER TABLE "purchase_drafts" ADD COLUMN IF NOT EXISTS "owner_user_id" uuid REFERENCES "users"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_drafts_plan_item_id_idx" ON "purchase_drafts" ("plan_item_id");
