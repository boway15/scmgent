-- scm-agent 妙搭新建应用 · 数据库一键初始化
-- 生成: pnpm miaoda:init-sql
-- 用法: 妙搭「数据库 → SQL 执行」粘贴本文件全文并运行（约 2–5 分钟）
-- 注意: 仅用于空库首次初始化；已有数据的库勿重复执行
-- 可选演示数据: drizzle/patch_furniture_names.sql（本文件不含）

BEGIN;


-- ============================================================
-- migration: 0000_naive_cyclops.sql
-- source: /packages/db/drizzle/0000_naive_cyclops.sql
-- ============================================================

DO $$ BEGIN
 CREATE TYPE "public"."calc_method" AS ENUM('manual', 'eoq', 'dify_ai');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."data_source" AS ENUM('manual', 'import');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."alert_type" AS ENUM('below_safety', 'below_rop', 'stockout');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."reorder_status" AS ENUM('pending', 'accepted', 'ignored');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."material_requirement_status" AS ENUM('sufficient', 'shortage', 'ordered');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."pmc_status" AS ENUM('draft', 'confirmed', 'in_progress', 'completed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."kb_message_role" AS ENUM('user', 'assistant');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"icon" varchar(100),
	"path" varchar(200),
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_leaf" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menus_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feishu_user_id" varchar(100),
	"name" varchar(100) NOT NULL,
	"email" varchar(200) NOT NULL,
	"role_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finished_sku_id" uuid NOT NULL,
	"material_sku_id" uuid NOT NULL,
	"qty_per_unit" numeric(12, 4) NOT NULL,
	"unit" varchar(20) NOT NULL,
	"version" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"warehouse" varchar(100) NOT NULL,
	"qty_available" integer NOT NULL,
	"qty_in_transit" integer DEFAULT 0,
	"qty_reserved" integer DEFAULT 0,
	"recorded_date" date NOT NULL,
	"source" "data_source" DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "safety_stock_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"safety_stock_qty" integer NOT NULL,
	"reorder_point" integer NOT NULL,
	"reorder_qty" integer NOT NULL,
	"review_cycle_days" integer,
	"service_level" numeric(4, 2),
	"calc_method" "calc_method" DEFAULT 'manual' NOT NULL,
	"last_calc_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "safety_stock_config_sku_id_unique" UNIQUE("sku_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"sale_date" date NOT NULL,
	"qty_sold" integer NOT NULL,
	"channel" varchar(100),
	"source" "data_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"unit" varchar(20) NOT NULL,
	"category" varchar(100),
	"lead_time_days" integer,
	"moq" integer,
	"unit_cost" numeric(12, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skus_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reorder_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"suggested_qty" integer NOT NULL,
	"suggested_date" date NOT NULL,
	"reason" text,
	"status" "reorder_status" DEFAULT 'pending' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"alert_type" "alert_type" NOT NULL,
	"current_qty" integer NOT NULL,
	"safety_qty" integer NOT NULL,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"material_sku_id" uuid NOT NULL,
	"required_qty" integer NOT NULL,
	"available_qty" integer,
	"gap_qty" integer,
	"status" "material_requirement_status" DEFAULT 'sufficient' NOT NULL,
	"calc_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pmc_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"planned_qty" integer NOT NULL,
	"completed_qty" integer DEFAULT 0,
	"unit" varchar(20) NOT NULL,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pmc_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_no" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"plan_date" timestamp with time zone NOT NULL,
	"delivery_date" timestamp with time zone NOT NULL,
	"status" "pmc_status" DEFAULT 'draft' NOT NULL,
	"remark" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pmc_plans_plan_no_unique" UNIQUE("plan_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"dify_conversation_id" varchar(200),
	"title" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "kb_message_role" NOT NULL,
	"content" text NOT NULL,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "menus" ADD CONSTRAINT "menus_parent_id_menus_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."menus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bom" ADD CONSTRAINT "bom_finished_sku_id_skus_id_fk" FOREIGN KEY ("finished_sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bom" ADD CONSTRAINT "bom_material_sku_id_skus_id_fk" FOREIGN KEY ("material_sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_records" ADD CONSTRAINT "inventory_records_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_records" ADD CONSTRAINT "inventory_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "safety_stock_config" ADD CONSTRAINT "safety_stock_config_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_plan_id_pmc_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pmc_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_material_sku_id_skus_id_fk" FOREIGN KEY ("material_sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pmc_plan_items" ADD CONSTRAINT "pmc_plan_items_plan_id_pmc_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pmc_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pmc_plan_items" ADD CONSTRAINT "pmc_plan_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pmc_plans" ADD CONSTRAINT "pmc_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kb_conversations" ADD CONSTRAINT "kb_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kb_messages" ADD CONSTRAINT "kb_messages_conversation_id_kb_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."kb_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_menus_role_id_menu_id_idx" ON "role_menus" ("role_id","menu_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_finished_sku_id_idx" ON "bom" ("finished_sku_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "safety_stock_config_sku_id_idx" ON "safety_stock_config" ("sku_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_history_sku_id_sale_date_idx" ON "sales_history" ("sku_id","sale_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pmc_plans_status_plan_date_idx" ON "pmc_plans" ("status","plan_date");


-- ============================================================
-- migration: 0001_purchase_drafts.sql
-- source: /packages/db/drizzle/0001_purchase_drafts.sql
-- ============================================================

DO $$ BEGIN
 CREATE TYPE "public"."purchase_draft_status" AS ENUM('draft', 'submitted', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."purchase_draft_source" AS ENUM('reorder', 'pmc', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_no" varchar(100) NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"expected_date" date,
	"source" "purchase_draft_source" DEFAULT 'manual' NOT NULL,
	"source_ref_id" uuid,
	"status" "purchase_draft_status" DEFAULT 'draft' NOT NULL,
	"remark" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_drafts_draft_no_unique" UNIQUE("draft_no")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_drafts" ADD CONSTRAINT "purchase_drafts_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_drafts" ADD CONSTRAINT "purchase_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_drafts_status_idx" ON "purchase_drafts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_drafts_sku_id_idx" ON "purchase_drafts" USING btree ("sku_id");


-- ============================================================
-- migration: 0002_fob_settlement.sql
-- source: /packages/db/drizzle/0002_fob_settlement.sql
-- ============================================================

DO $$ BEGIN
 CREATE TYPE "public"."fob_settlement_status" AS ENUM('draft', 'imported', 'calculated', 'confirmed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_cost_stage" AS ENUM('trucking', 'freight', 'customs', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_settlement_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_no" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"settlement_period" varchar(7) NOT NULL,
	"usd_to_cny_rate" numeric(10, 4) DEFAULT '7.25' NOT NULL,
	"status" "fob_settlement_status" DEFAULT 'draft' NOT NULL,
	"remark" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fob_settlement_batches_batch_no_unique" UNIQUE("batch_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_merchant_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"merchant_code" varchar(100) NOT NULL,
	"merchant_name" varchar(200),
	"container_no" varchar(50) NOT NULL,
	"sku_code" varchar(100),
	"qty" integer,
	"volume_cbm" numeric(12, 4) NOT NULL,
	"weight_kg" numeric(12, 3),
	"remark" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_trucking_bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"container_no" varchar(50) NOT NULL,
	"internal_no" varchar(100),
	"bl_no" varchar(100),
	"ship_date" varchar(50),
	"load_address" text,
	"fee_type" varchar(100) NOT NULL,
	"amount_cny" numeric(14, 2) NOT NULL,
	"source_row" integer,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_freight_bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"container_no" varchar(50) NOT NULL,
	"order_no" varchar(100),
	"bl_no" varchar(100),
	"biz_date" varchar(50),
	"dest_port" varchar(50),
	"volume_cbm" numeric(12, 4),
	"fee_type" varchar(100) NOT NULL,
	"stage" "fob_cost_stage" DEFAULT 'freight' NOT NULL,
	"amount_cny" numeric(14, 2) NOT NULL,
	"original_currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"original_amount" numeric(14, 2),
	"exchange_rate" numeric(10, 4),
	"source_row" integer,
	"panel_side" varchar(10),
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_settlement_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"container_no" varchar(50) NOT NULL,
	"merchant_code" varchar(100) NOT NULL,
	"merchant_name" varchar(200),
	"stage" "fob_cost_stage" NOT NULL,
	"fee_type" varchar(100) NOT NULL,
	"source_bill_type" varchar(20) NOT NULL,
	"source_ref" varchar(200),
	"source_amount_cny" numeric(14, 2) NOT NULL,
	"merchant_volume_cbm" numeric(12, 4) NOT NULL,
	"volume_ratio" numeric(10, 6) NOT NULL,
	"allocated_amount_cny" numeric(14, 2) NOT NULL,
	"is_tail_adjustment" boolean DEFAULT false NOT NULL,
	"calc_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_batches" ADD CONSTRAINT "fob_settlement_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_merchant_shipments" ADD CONSTRAINT "fob_merchant_shipments_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_trucking_bill_items" ADD CONSTRAINT "fob_trucking_bill_items_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_freight_bill_items" ADD CONSTRAINT "fob_freight_bill_items_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_allocations" ADD CONSTRAINT "fob_settlement_allocations_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_settlement_batches_period_idx" ON "fob_settlement_batches" USING btree ("settlement_period","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_merchant_shipments_batch_container_idx" ON "fob_merchant_shipments" USING btree ("batch_id","container_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_trucking_bill_items_batch_container_idx" ON "fob_trucking_bill_items" USING btree ("batch_id","container_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_freight_bill_items_batch_container_idx" ON "fob_freight_bill_items" USING btree ("batch_id","container_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_settlement_allocations_batch_merchant_idx" ON "fob_settlement_allocations" USING btree ("batch_id","merchant_code");


-- ============================================================
-- migration: 0003_plan_merchant_inventory.sql
-- source: /packages/db/drizzle/0003_plan_merchant_inventory.sql
-- ============================================================

ALTER TABLE "inventory_records" ADD COLUMN IF NOT EXISTS "qty_in_production" integer DEFAULT 0;

ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "merchant_code" varchar(100);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "merchant_name" varchar(200);

ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "merchant_code" varchar(100);
ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "merchant_name" varchar(200);
UPDATE "pmc_plans" SET "merchant_code" = 'UNKNOWN' WHERE "merchant_code" IS NULL;
ALTER TABLE "pmc_plans" ALTER COLUMN "merchant_code" SET NOT NULL;

ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "plan_id" uuid;
DO $$ BEGIN
 ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_plan_id_pmc_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pmc_plans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;


-- ============================================================
-- migration: 0004_remove_pmc_import_menu.sql
-- source: /packages/db/drizzle/0004_remove_pmc_import_menu.sql
-- ============================================================

-- PMC 计划导入已合并至「数据中心 → 数据导入」，移除重复的 pmc.import 菜单
DELETE FROM "role_menus"
WHERE "menu_id" IN (SELECT "id" FROM "menus" WHERE "code" = 'pmc.import');
--> statement-breakpoint
DELETE FROM "menus" WHERE "code" = 'pmc.import';


-- ============================================================
-- migration: 0005_warehouses_multichannel.sql
-- source: /packages/db/drizzle/0005_warehouses_multichannel.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(100) NOT NULL UNIQUE,
  "name" varchar(200) NOT NULL,
  "region_group" varchar(50) NOT NULL,
  "country_code" varchar(10),
  "allow_cross_fulfill" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "channel_warehouse_prefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel" varchar(100) NOT NULL UNIQUE,
  "primary_warehouse_code" varchar(100) NOT NULL,
  "overflow_warehouse_codes" varchar(500),
  "last_mile_cost_index" numeric(6,2) DEFAULT 1 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "sales_history" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100);
CREATE INDEX IF NOT EXISTS "sales_history_sku_warehouse_idx" ON "sales_history" ("sku_id", "warehouse_code");

ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100) DEFAULT 'ALL' NOT NULL;
UPDATE "safety_stock_config" SET "warehouse_code" = 'ALL' WHERE "warehouse_code" IS NULL;
DROP INDEX IF EXISTS "safety_stock_config_sku_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "safety_stock_config_sku_warehouse_idx" ON "safety_stock_config" ("sku_id", "warehouse_code");

ALTER TABLE "pmc_plans" ADD COLUMN IF NOT EXISTS "target_warehouse_code" varchar(100);
ALTER TABLE "pmc_plan_items" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100);
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100);

INSERT INTO "warehouses" ("code", "name", "region_group", "country_code", "allow_cross_fulfill", "sort_order")
VALUES
  ('US-WEST', '美西仓', 'US', 'US', true, 1),
  ('US-SOUTH', '美南仓', 'US', 'US', true, 2),
  ('US-SOUTHEAST', '美东南仓', 'US', 'US', true, 3),
  ('US-EAST', '美东仓', 'US', 'US', true, 4),
  ('DE', '德国仓', 'EU', 'DE', false, 5),
  ('UK', '英国仓', 'UK', 'GB', false, 6)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "channel_warehouse_prefs" ("channel", "primary_warehouse_code", "overflow_warehouse_codes", "last_mile_cost_index")
VALUES
  ('amazon', 'US-WEST', 'US-SOUTH,US-SOUTHEAST,US-EAST', 1.15),
  ('wayfair', 'US-EAST', 'US-SOUTHEAST,US-SOUTH,US-WEST', 1.20),
  ('walmart', 'US-SOUTH', 'US-SOUTHEAST,US-EAST,US-WEST', 1.18),
  ('faire', 'US-EAST', 'US-SOUTHEAST,US-WEST,US-SOUTH', 1.25)
ON CONFLICT ("channel") DO NOTHING;


-- ============================================================
-- migration: 0006_product_master_data.sql
-- source: /packages/db/drizzle/0006_product_master_data.sql
-- ============================================================

-- 商品主数据：SPU / 商家 / SKU 供货关系 / 合规属性

CREATE TABLE IF NOT EXISTS "spus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(100) NOT NULL,
  "name" varchar(200) NOT NULL,
  "category" varchar(100),
  "brand" varchar(100),
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "spus_code_unique" UNIQUE("code")
);

CREATE INDEX IF NOT EXISTS "spus_category_idx" ON "spus" ("category");

CREATE TABLE IF NOT EXISTS "merchants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(100) NOT NULL,
  "name" varchar(200) NOT NULL,
  "contact_name" varchar(100),
  "contact_phone" varchar(50),
  "contact_email" varchar(200),
  "country_code" varchar(2),
  "payment_terms" varchar(100),
  "remark" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "merchants_code_unique" UNIQUE("code")
);

ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "spu_id" uuid;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "spec_attrs" jsonb;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "barcode" varchar(100);

DO $$ BEGIN
  ALTER TABLE "skus" ADD CONSTRAINT "skus_spu_id_spus_id_fk"
    FOREIGN KEY ("spu_id") REFERENCES "public"."spus"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "skus_spu_id_idx" ON "skus" ("spu_id");

CREATE TABLE IF NOT EXISTS "sku_suppliers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL,
  "merchant_id" uuid NOT NULL,
  "unit_price" numeric(12, 4),
  "lead_time_days" integer,
  "moq" integer,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "sku_suppliers" ADD CONSTRAINT "sku_suppliers_sku_id_skus_id_fk"
    FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "sku_suppliers" ADD CONSTRAINT "sku_suppliers_merchant_id_merchants_id_fk"
    FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "sku_suppliers_sku_merchant_idx" ON "sku_suppliers" ("sku_id", "merchant_id");
CREATE INDEX IF NOT EXISTS "sku_suppliers_sku_id_idx" ON "sku_suppliers" ("sku_id");
CREATE INDEX IF NOT EXISTS "sku_suppliers_merchant_id_idx" ON "sku_suppliers" ("merchant_id");

CREATE TABLE IF NOT EXISTS "sku_compliance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL,
  "hs_code" varchar(20),
  "origin_country" varchar(2),
  "declared_value" numeric(12, 4),
  "weight_kg" numeric(10, 4),
  "length_cm" numeric(8, 2),
  "width_cm" numeric(8, 2),
  "height_cm" numeric(8, 2),
  "battery_type" varchar(50),
  "is_liquid" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sku_compliance_sku_id_unique" UNIQUE("sku_id")
);

DO $$ BEGIN
  ALTER TABLE "sku_compliance" ADD CONSTRAINT "sku_compliance_sku_id_skus_id_fk"
    FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 从现有 SKU 冗余商家字段回填商家主数据
INSERT INTO "merchants" ("code", "name")
SELECT DISTINCT s."merchant_code", COALESCE(NULLIF(TRIM(s."merchant_name"), ''), s."merchant_code")
FROM "skus" s
WHERE s."merchant_code" IS NOT NULL AND TRIM(s."merchant_code") <> ''
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updated_at" = now();

-- 现有 SKU 各建一条 SPU（过渡策略，后续可合并）
INSERT INTO "spus" ("code", "name", "category")
SELECT s."code", s."name", s."category"
FROM "skus" s
WHERE NOT EXISTS (SELECT 1 FROM "spus" p WHERE p."code" = s."code")
ON CONFLICT ("code") DO NOTHING;

UPDATE "skus" s
SET "spu_id" = p."id"
FROM "spus" p
WHERE s."spu_id" IS NULL AND p."code" = s."code";

-- 回填 SKU 供货关系
INSERT INTO "sku_suppliers" ("sku_id", "merchant_id", "unit_price", "lead_time_days", "moq", "is_default")
SELECT s."id", m."id", s."unit_cost", s."lead_time_days", s."moq", true
FROM "skus" s
INNER JOIN "merchants" m ON m."code" = s."merchant_code"
WHERE s."merchant_code" IS NOT NULL AND TRIM(s."merchant_code") <> ''
ON CONFLICT ("sku_id", "merchant_id") DO NOTHING;


-- ============================================================
-- migration: 0007_product_master_menu.sql
-- source: /packages/db/drizzle/0007_product_master_menu.sql
-- ============================================================

-- 商品主数据菜单（已有环境增量）

INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.products', '商品主数据', '/data/products', p."id", 1, true
FROM "menus" p
WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;

UPDATE "menus" SET "sort_order" = 2 WHERE "code" = 'data.import';

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE m."code" = 'data.products'
  AND r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;


-- ============================================================
-- migration: 0008_stock_alerts_warehouse.sql
-- source: /packages/db/drizzle/0008_stock_alerts_warehouse.sql
-- ============================================================

ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "warehouse_code" varchar(100);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_alerts_sku_warehouse_idx" ON "stock_alerts" ("sku_id", "warehouse_code");


-- ============================================================
-- migration: 0009_dashboard_compliance_menus.sql
-- source: /packages/db/drizzle/0009_dashboard_compliance_menus.sql
-- ============================================================

-- 经营看板、合规管理、销量历史、采购跟单菜单（已有环境增量）

INSERT INTO "menus" ("code", "name", "icon", "path", "sort_order", "is_leaf")
VALUES ('dashboard', '经营看板', 'LayoutDashboard', '/dashboard', 0, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "icon", "sort_order", "is_leaf")
VALUES ('compliance', '合规管理', 'Shield', 3, false)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'compliance.overview', '合规总览', '/compliance/overview', p."id", 1, true
FROM "menus" p WHERE p."code" = 'compliance'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'compliance.skus', 'SKU 合规', '/compliance/skus', p."id", 2, true
FROM "menus" p WHERE p."code" = 'compliance'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'data.sales', '销量历史', '/data/sales', p."id", 3, true
FROM "menus" p WHERE p."code" = 'data'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'pmc.tracking', '采购跟单', '/pmc/tracking', p."id", 3, true
FROM "menus" p WHERE p."code" = 'pmc'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- 为各角色授权新菜单（幂等）
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'super_admin'
  AND m."code" IN ('dashboard', 'compliance', 'compliance.overview', 'compliance.skus', 'data.sales', 'pmc.tracking')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'pmc_planner'
  AND m."code" IN ('dashboard', 'compliance', 'compliance.overview', 'compliance.skus', 'data.sales')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" IN ('warehouse', 'purchaser', 'viewer')
  AND m."code" IN ('dashboard', 'compliance', 'compliance.overview', 'compliance.skus', 'data.sales')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'purchaser'
  AND m."code" = 'pmc.tracking'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'viewer'
  AND m."code" IN ('pmc.tracking', 'pmc.suggestion')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;
--> statement-breakpoint
-- 合并「菜单配置」到「角色与菜单」，移除重复入口
DELETE FROM "role_menus" WHERE "menu_id" IN (SELECT "id" FROM "menus" WHERE "code" = 'system.menus');
--> statement-breakpoint
DELETE FROM "menus" WHERE "code" = 'system.menus';
--> statement-breakpoint
UPDATE "menus" SET "name" = '角色与菜单' WHERE "code" = 'system.roles';


-- ============================================================
-- migration: 0010_replenish_light.sql
-- source: /packages/db/drizzle/0010_replenish_light.sql
-- ============================================================

DO $$ BEGIN
 CREATE TYPE "public"."replenish_light" AS ENUM('red', 'yellow', 'green');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "replenish_light" "replenish_light" DEFAULT 'red' NOT NULL;


-- ============================================================
-- migration: 0011_spu_moq.sql
-- source: /packages/db/drizzle/0011_spu_moq.sql
-- ============================================================

ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "moq" integer;


-- ============================================================
-- migration: 0011_help_center_menu.sql
-- source: /packages/db/drizzle/0011_help_center_menu.sql
-- ============================================================

-- 帮助中心菜单（全角色可见）

INSERT INTO "menus" ("code", "name", "icon", "path", "sort_order", "is_leaf")
VALUES ('help', '帮助中心', 'HelpCircle', '/help', 98, true)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "icon" = EXCLUDED."icon",
  "path" = EXCLUDED."path",
  "sort_order" = EXCLUDED."sort_order",
  "is_leaf" = EXCLUDED."is_leaf";
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE m."code" = 'help'
  AND r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;


-- ============================================================
-- migration: 0012_fob_multi_allocation.sql
-- source: /packages/db/drizzle/0012_fob_multi_allocation.sql
-- ============================================================

DO $$ BEGIN
 ALTER TYPE "public"."fob_settlement_status" ADD VALUE IF NOT EXISTS 'reviewed' BEFORE 'calculated';
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_allocation_method" AS ENUM('by_volume', 'by_ticket', 'fixed', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_exception_status" AS ENUM('pending', 'confirmed', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_adjust_type" AS ENUM('amount', 'merchant', 'exclude', 'ticket_count');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_fee_allocation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_type" varchar(100),
	"source_bill_type" varchar(20) NOT NULL,
	"match_pattern" varchar(100),
	"allocation_method" "fob_allocation_method" NOT NULL,
	"default_stage" "fob_cost_stage" DEFAULT 'other' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_container_merchant_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"container_no" varchar(50) NOT NULL,
	"merchant_code" varchar(100) NOT NULL,
	"merchant_name" varchar(200),
	"volume_cbm" numeric(12, 4) NOT NULL,
	"ticket_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_settlement_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"allocation_id" uuid,
	"bill_item_id" uuid,
	"bill_item_type" varchar(20),
	"adjust_type" "fob_adjust_type" NOT NULL,
	"original_value" text,
	"adjusted_value" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "allocation_method" "fob_allocation_method";
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "is_exception" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "exception_status" "fob_exception_status";
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "assigned_merchant_code" varchar(100);
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "adjusted_amount_cny" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "review_note" text;
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "reviewed_by" uuid;
--> statement-breakpoint
ALTER TABLE "fob_trucking_bill_items" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "allocation_method" "fob_allocation_method";
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "is_exception" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "exception_status" "fob_exception_status";
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "assigned_merchant_code" varchar(100);
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "adjusted_amount_cny" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "review_note" text;
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "reviewed_by" uuid;
--> statement-breakpoint
ALTER TABLE "fob_freight_bill_items" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "source_bill_item_id" uuid;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "allocation_method" "fob_allocation_method" DEFAULT 'by_volume' NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "ticket_count" integer;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "ticket_ratio" numeric(10, 6);
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "is_manual_override" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ADD COLUMN IF NOT EXISTS "override_reason" text;
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ALTER COLUMN "merchant_volume_cbm" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "fob_settlement_allocations" ALTER COLUMN "volume_ratio" SET DEFAULT '0';
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_container_merchant_stats" ADD CONSTRAINT "fob_container_merchant_stats_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_adjustments" ADD CONSTRAINT "fob_settlement_adjustments_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_adjustments" ADD CONSTRAINT "fob_settlement_adjustments_allocation_id_fob_settlement_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."fob_settlement_allocations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_adjustments" ADD CONSTRAINT "fob_settlement_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_trucking_bill_items" ADD CONSTRAINT "fob_trucking_bill_items_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_freight_bill_items" ADD CONSTRAINT "fob_freight_bill_items_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_fee_allocation_rules_bill_type_idx" ON "fob_fee_allocation_rules" USING btree ("source_bill_type","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fob_container_merchant_stats_uq" ON "fob_container_merchant_stats" USING btree ("batch_id","container_no","merchant_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_settlement_adjustments_batch_idx" ON "fob_settlement_adjustments" USING btree ("batch_id");


-- ============================================================
-- seed: miaoda-seed-roles-menus.sql
-- source: /docs/sql/miaoda-seed-roles-menus.sql
-- ============================================================

-- Miaoda seed: roles, menus, role_menus, default admin
-- Prerequisite: drizzle migrations 0000-0012
-- Idempotent: safe to re-run

INSERT INTO roles (name, code, description, is_system) VALUES ('超级管理员', 'super_admin', '管理角色/菜单/用户', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO roles (name, code, description, is_system) VALUES ('PMC 计划员', 'pmc_planner', '管理 PMC 计划', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO roles (name, code, description, is_system) VALUES ('仓库员', 'warehouse', '录入库存/出入库', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO roles (name, code, description, is_system) VALUES ('采购员', 'purchaser', '管理采购/补货', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO roles (name, code, description, is_system) VALUES ('只读查看', 'viewer', '只读访问', true) ON CONFLICT (code) DO NOTHING;

INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '经营看板', 'dashboard', 'LayoutDashboard', '/dashboard', NULL, 0, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'dashboard');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '库存管理', 'inventory', 'Package', NULL, NULL, 1, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '库存总览', 'inventory.overview', NULL, '/inventory/overview', (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.overview');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '安全库存设置', 'inventory.safety', NULL, '/inventory/safety', (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.safety');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '缺货预警', 'inventory.alert', NULL, '/inventory/alerts', (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 3, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.alert');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '下单计划', 'pmc', 'ClipboardList', NULL, NULL, 2, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'pmc');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '补货建议', 'pmc.suggestion', NULL, '/pmc/suggestions', (SELECT id FROM menus WHERE code = 'pmc' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'pmc.suggestion');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '计划列表', 'pmc.list', NULL, '/pmc/list', (SELECT id FROM menus WHERE code = 'pmc' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'pmc.list');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '采购跟单', 'pmc.tracking', NULL, '/pmc/tracking', (SELECT id FROM menus WHERE code = 'pmc' LIMIT 1), 3, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'pmc.tracking');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '合规管理', 'compliance', 'Shield', NULL, NULL, 3, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'compliance');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '合规总览', 'compliance.overview', NULL, '/compliance/overview', (SELECT id FROM menus WHERE code = 'compliance' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'compliance.overview');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT 'SKU 合规', 'compliance.skus', NULL, '/compliance/skus', (SELECT id FROM menus WHERE code = 'compliance' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'compliance.skus');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '物流管理', 'logistics', 'Truck', NULL, NULL, 4, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'logistics');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT 'FOB分账', 'logistics.fob_settlement', NULL, '/logistics/fob-settlement', (SELECT id FROM menus WHERE code = 'logistics' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'logistics.fob_settlement');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT 'AI 知识库', 'ai', 'Bot', NULL, NULL, 5, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'ai');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '知识问答', 'ai.chat', NULL, '/ai/chat', (SELECT id FROM menus WHERE code = 'ai' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'ai.chat');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '数据中心', 'data', 'ClipboardList', NULL, NULL, 6, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '商品主数据', 'data.products', NULL, '/data/products', (SELECT id FROM menus WHERE code = 'data' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data.products');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '数据导入', 'data.import', NULL, '/data/import', (SELECT id FROM menus WHERE code = 'data' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data.import');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '销量历史', 'data.sales', NULL, '/data/sales', (SELECT id FROM menus WHERE code = 'data' LIMIT 1), 3, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data.sales');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '帮助中心', 'help', 'HelpCircle', '/help', NULL, 98, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'help');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '系统设置', 'system', 'Settings', NULL, NULL, 99, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '用户管理', 'system.users', NULL, '/system/users', (SELECT id FROM menus WHERE code = 'system' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system.users');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '角色与菜单', 'system.roles', NULL, '/system/roles', (SELECT id FROM menus WHERE code = 'system' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system.roles');

INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'dashboard' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'inventory' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'inventory.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'inventory.safety' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'inventory.alert' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'pmc' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'pmc.suggestion' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'pmc.list' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'pmc.tracking' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'compliance' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'compliance.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'compliance.skus' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'logistics' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'logistics.fob_settlement' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'data' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'data.products' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'data.import' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'data.sales' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'ai' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'ai.chat' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'help' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'system' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'system.users' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'system.roles' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'dashboard' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'inventory' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'inventory.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'inventory.safety' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'pmc' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'pmc.suggestion' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'pmc.list' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'compliance' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'compliance.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'compliance.skus' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'logistics' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'logistics.fob_settlement' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'data' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'data.products' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'data.import' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'data.sales' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'ai' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'ai.chat' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'help' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'dashboard' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'inventory' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'inventory.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'inventory.alert' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'pmc' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'pmc.list' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'compliance' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'compliance.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'compliance.skus' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'logistics' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'logistics.fob_settlement' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'data' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'data.products' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'data.import' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'data.sales' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'ai' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'ai.chat' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'help' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'dashboard' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'inventory' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'inventory.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'inventory.safety' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'inventory.alert' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'pmc' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'pmc.list' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'pmc.tracking' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'compliance' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'compliance.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'compliance.skus' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'logistics' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'logistics.fob_settlement' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'data' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'data.products' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'data.import' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'data.sales' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'ai' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'ai.chat' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'help' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'dashboard' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'inventory' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'inventory.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'pmc' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'pmc.suggestion' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'pmc.list' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'pmc.tracking' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'compliance' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'compliance.overview' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'compliance.skus' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'logistics' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'logistics.fob_settlement' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'data' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'data.sales' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'ai' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'ai.chat' ON CONFLICT (role_id, menu_id) DO NOTHING;
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'help' ON CONFLICT (role_id, menu_id) DO NOTHING;

INSERT INTO users (name, email, role_id, is_active) SELECT '系统管理员', 'admin@scm.local', r.id, true FROM roles r WHERE r.code = 'super_admin' AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@scm.local');


-- ============================================================
-- seed: seed-fob-fee-rules.sql
-- source: /docs/sql/seed-fob-fee-rules.sql
-- ============================================================

-- FOB fee rules seed: 75 rows
-- Table: fob_fee_allocation_rules
-- Prerequisite: 0012_fob_multi_allocation.sql
-- Idempotent: skips rows that already exist (same source_bill_type + fee_type or match_pattern)

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '拖车费', 'trucking', NULL, 'by_volume', 'trucking', 10000, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '拖车费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '多地费', 'trucking', NULL, 'by_ticket', 'trucking', 9999, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '多地费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '过磅费', 'trucking', NULL, 'by_volume', 'trucking', 9998, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '过磅费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '超重费', 'trucking', NULL, 'by_volume', 'trucking', 9997, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '超重费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '提卸费', 'trucking', NULL, 'by_volume', 'trucking', 9996, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '提卸费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '堆场港杂费', 'trucking', NULL, 'by_volume', 'trucking', 9995, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '堆场港杂费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '堆存费', 'trucking', NULL, 'by_volume', 'trucking', 9994, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '堆存费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '条码费', 'trucking', NULL, 'by_ticket', 'trucking', 9993, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '条码费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '提箱费', 'trucking', NULL, 'by_ticket', 'trucking', 9992, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '提箱费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '进港费', 'trucking', NULL, 'by_volume', 'trucking', 9991, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '进港费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '待时费', 'trucking', NULL, 'by_volume', 'other', 9990, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '待时费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '预提费', 'trucking', NULL, 'by_ticket', 'trucking', 9989, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '预提费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '异提费', 'trucking', NULL, 'by_ticket', 'trucking', 9988, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '异提费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '落箱费', 'trucking', NULL, 'by_volume', 'trucking', 9987, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '落箱费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '码头费', 'trucking', NULL, 'by_volume', 'trucking', 9986, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '码头费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '超期费', 'trucking', NULL, 'by_volume', 'other', 9985, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '超期费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '场站操作包干费', 'trucking', NULL, 'by_volume', 'trucking', 9984, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '场站操作包干费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '进仓费', 'trucking', NULL, 'by_volume', 'trucking', 9983, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '进仓费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '装箱费', 'trucking', NULL, 'by_volume', 'trucking', 9982, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '装箱费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '堆场吊机费', 'trucking', NULL, 'by_volume', 'trucking', 9981, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '堆场吊机费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '高温费', 'trucking', NULL, 'by_volume', 'other', 9980, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '高温费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '高速费', 'trucking', NULL, 'by_volume', 'trucking', 9979, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '高速费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '约柜费', 'trucking', NULL, 'by_ticket', 'trucking', 9978, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '约柜费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '提空费', 'trucking', NULL, 'by_ticket', 'trucking', 9977, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '提空费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '压夜费', 'trucking', NULL, 'manual', 'other', 9976, true, '平账时指定承担主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '压夜费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '场站费', 'trucking', NULL, 'by_volume', 'trucking', 9975, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '场站费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '单证费', 'trucking', NULL, 'by_ticket', 'trucking', 9974, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '单证费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '买单费', 'trucking', NULL, 'by_ticket', 'customs', 9973, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '买单费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '商检费', 'trucking', NULL, 'by_ticket', 'customs', 9972, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '商检费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '报关费', 'trucking', NULL, 'by_ticket', 'customs', 9971, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '报关费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '查验费', 'trucking', NULL, 'by_ticket', 'customs', 9970, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '查验费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '其他', 'trucking', NULL, 'manual', 'other', 9969, true, '需人工确认归属'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '其他' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'ORC', 'freight', NULL, 'by_volume', 'freight', 5000, true, '按 USD 折算'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'ORC' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '文件费', 'freight', NULL, 'by_ticket', 'freight', 4999, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '文件费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '封条费', 'freight', NULL, 'by_ticket', 'freight', 4998, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '封条费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '打单费', 'freight', NULL, 'by_ticket', 'freight', 4997, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '打单费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '电放费', 'freight', NULL, 'by_ticket', 'freight', 4996, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '电放费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'VGM', 'freight', NULL, 'by_ticket', 'freight', 4995, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'VGM' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'ISPS', 'freight', NULL, 'by_ticket', 'freight', 4994, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'ISPS' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '订舱', 'freight', NULL, 'by_ticket', 'freight', 4993, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '订舱' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '转关打单', 'freight', NULL, 'by_ticket', 'customs', 4992, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '转关打单' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '舱单费/舱单预录费', 'freight', NULL, 'by_ticket', 'freight', 4991, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '舱单费/舱单预录费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '港杂费', 'freight', NULL, 'by_volume', 'freight', 4990, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '港杂费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '箱单费', 'freight', NULL, 'by_ticket', 'freight', 4989, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '箱单费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '排载申报费', 'freight', NULL, 'by_ticket', 'customs', 4988, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '排载申报费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '刷申报费', 'freight', NULL, 'by_ticket', 'customs', 4987, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '刷申报费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '青岛港提箱费+安保+场站+港杂+提箱+综合服务费', 'freight', NULL, 'by_volume', 'freight', 4986, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '青岛港提箱费+安保+场站+港杂+提箱+综合服务费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '操作费', 'freight', NULL, 'by_volume', 'freight', 4985, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '操作费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'Handing', 'freight', NULL, 'by_ticket', 'freight', 4984, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'Handing' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'EDI', 'freight', NULL, 'by_ticket', 'freight', 4983, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'EDI' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT 'EIR', 'freight', NULL, 'by_ticket', 'freight', 4982, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = 'EIR' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '退载费', 'freight', NULL, 'manual', 'other', 4981, true, '需人工确认'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '退载费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '转船费', 'freight', NULL, 'manual', 'other', 4980, true, '需人工确认'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '转船费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '改单费', 'freight', NULL, 'manual', 'other', 4979, true, '需人工确认'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '改单费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '出口服务费', 'freight', NULL, 'by_volume', 'freight', 4978, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.fee_type = '出口服务费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '多点提货费', 'trucking', NULL, 'by_ticket', 'trucking', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '多点提货费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '超时等待费', 'trucking', NULL, 'by_volume', 'other', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '超时等待费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '落地寄柜费', 'trucking', NULL, 'by_volume', 'trucking', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '落地寄柜费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '延误费', 'trucking', NULL, 'manual', 'other', 10, true, '需人工识别归属主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '延误费' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '指定柜号', 'trucking', NULL, 'manual', 'other', 10, true, '平账时指定承担主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '指定柜号' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT '其他费用', 'trucking', NULL, 'manual', 'other', 5, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.fee_type = '其他费用' AND r.match_pattern IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '海运费', 'by_volume', 'freight', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '海运费' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', 'THC', 'by_volume', 'freight', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = 'THC' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '码头', 'by_volume', 'freight', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '码头' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '拖车费', 'by_volume', 'trucking', 10, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '拖车费' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'trucking', '延误', 'manual', 'other', 15, true, '需人工识别归属主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.match_pattern = '延误' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '延误', 'manual', 'other', 15, true, '需人工识别归属主体'
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '延误' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'trucking', '异常', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.match_pattern = '异常' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '异常', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '异常' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'trucking', '减免', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.match_pattern = '减免' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '减免', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '减免' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'trucking', '多收', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'trucking' AND r.match_pattern = '多收' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '多收', 'manual', 'other', 20, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '多收' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '报关', 'by_ticket', 'customs', 12, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '报关' AND r.fee_type IS NULL);

INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)
SELECT NULL, 'freight', '查验', 'by_ticket', 'customs', 12, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = 'freight' AND r.match_pattern = '查验' AND r.fee_type IS NULL);


COMMIT;

-- 验证（可选，单独执行）:
-- SELECT count(*) FROM roles;
-- SELECT email FROM users WHERE email = 'admin@scm.local';
-- SELECT count(*) FROM fob_fee_allocation_rules;
