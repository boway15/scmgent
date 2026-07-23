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
-- migration: 0013_fob_settlement_split_v2.sql
-- source: /packages/db/drizzle/0013_fob_settlement_split_v2.sql
-- ============================================================

-- FOB split v2: service providers, batch type, merchant payment status
-- Purge historical FOB transactional data (per PRD; fee rules retained)

DELETE FROM "fob_settlement_adjustments";
DELETE FROM "fob_settlement_allocations";
DELETE FROM "fob_container_merchant_stats";
DELETE FROM "fob_merchant_shipments";
DELETE FROM "fob_trucking_bill_items";
DELETE FROM "fob_freight_bill_items";
DELETE FROM "fob_settlement_batches";
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_settlement_type" AS ENUM('trucking', 'freight');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_provider_type" AS ENUM('trucking', 'freight');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_bill_format" AS ENUM('senwei_original', 'huamao_original', 'simplified_wide');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fob_payment_status" AS ENUM('paid', 'unpaid', 'not_required');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_service_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"provider_type" "fob_provider_type" NOT NULL,
	"bill_format" "fob_bill_format" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fob_service_providers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_service_providers_type_active_idx" ON "fob_service_providers" ("provider_type", "is_active");
--> statement-breakpoint
INSERT INTO "fob_service_providers" ("code", "name", "provider_type", "bill_format", "sort_order", "is_active")
VALUES
  ('senwei', '森威', 'trucking', 'senwei_original', 10, true),
  ('huamao', '华贸', 'freight', 'huamao_original', 10, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "fob_settlement_batches" ADD COLUMN IF NOT EXISTS "settlement_type" "fob_settlement_type";
--> statement-breakpoint
ALTER TABLE "fob_settlement_batches" ADD COLUMN IF NOT EXISTS "service_provider_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_settlement_batches" ADD CONSTRAINT "fob_settlement_batches_service_provider_id_fob_service_providers_id_fk" FOREIGN KEY ("service_provider_id") REFERENCES "public"."fob_service_providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "fob_settlement_batches" ALTER COLUMN "settlement_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "fob_settlement_batches" ALTER COLUMN "service_provider_id" SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fob_merchant_payment_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"merchant_code" varchar(100) NOT NULL,
	"payment_status" "fob_payment_status" DEFAULT 'unpaid' NOT NULL,
	"remark" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fob_merchant_payment_status_batch_merchant_uq" ON "fob_merchant_payment_status" ("batch_id", "merchant_code");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_merchant_payment_status" ADD CONSTRAINT "fob_merchant_payment_status_batch_id_fob_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fob_settlement_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fob_merchant_payment_status" ADD CONSTRAINT "fob_merchant_payment_status_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;


-- ============================================================
-- migration: 0014_p0_ops.sql
-- source: /packages/db/drizzle/0014_p0_ops.sql
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "import_batch_status" AS ENUM('pending', 'success', 'partial', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "task_run_status" AS ENUM('running', 'success', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "data_source" ADD VALUE IF NOT EXISTS 'pmc_receipt';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" varchar(50) NOT NULL,
  "file_name" varchar(255),
  "row_count" integer DEFAULT 0 NOT NULL,
  "success_count" integer DEFAULT 0 NOT NULL,
  "error_count" integer DEFAULT 0 NOT NULL,
  "status" "import_batch_status" DEFAULT 'pending' NOT NULL,
  "error_summary" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "import_batches_type_created_idx" ON "import_batches" ("type", "created_at");

CREATE TABLE IF NOT EXISTS "task_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_name" varchar(100) NOT NULL,
  "status" "task_run_status" DEFAULT 'running' NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz,
  "result_summary" text,
  "error_message" text,
  "triggered_by" varchar(200)
);

CREATE INDEX IF NOT EXISTS "task_runs_task_started_idx" ON "task_runs" ("task_name", "started_at");

CREATE TABLE IF NOT EXISTS "pmc_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "pmc_plans"("id") ON DELETE cascade,
  "plan_item_id" uuid NOT NULL REFERENCES "pmc_plan_items"("id") ON DELETE cascade,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id"),
  "warehouse_code" varchar(100) NOT NULL,
  "qty_received" integer NOT NULL,
  "received_date" date NOT NULL,
  "inventory_record_id" uuid REFERENCES "inventory_records"("id"),
  "idempotency_key" varchar(100),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "pmc_receipts_plan_item_idx" ON "pmc_receipts" ("plan_item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pmc_receipts_idempotency_key_idx" ON "pmc_receipts" ("idempotency_key");

ALTER TABLE "inventory_records" ADD COLUMN IF NOT EXISTS "import_batch_id" uuid;
ALTER TABLE "sales_history" ADD COLUMN IF NOT EXISTS "import_batch_id" uuid;


-- ============================================================
-- migration: 0015_drop_fob_bill_format.sql
-- source: /packages/db/drizzle/0015_drop_fob_bill_format.sql
-- ============================================================

-- Remove unused fob_service_providers.bill_format (import parses by file structure only)
ALTER TABLE "fob_service_providers" DROP COLUMN IF EXISTS "bill_format";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."fob_bill_format";


-- ============================================================
-- migration: 0016_remove_compliance.sql
-- source: /packages/db/drizzle/0016_remove_compliance.sql
-- ============================================================

-- 移除合规管理模块（菜单 + sku_compliance 表）

DELETE FROM "role_menus" WHERE "menu_id" IN (
  SELECT "id" FROM "menus" WHERE "code" IN ('compliance', 'compliance.overview', 'compliance.skus')
);
--> statement-breakpoint
DELETE FROM "menus" WHERE "code" IN ('compliance.overview', 'compliance.skus');
--> statement-breakpoint
DELETE FROM "menus" WHERE "code" = 'compliance';
--> statement-breakpoint
DROP TABLE IF EXISTS "sku_compliance";


-- ============================================================
-- migration: 0017_email_auth.sql
-- source: /packages/db/drizzle/0017_email_auth.sql
-- ============================================================

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" varchar(255);

INSERT INTO "roles" ("name", "code", "description", "is_system")
SELECT '待分配', 'pending', '注册或首次飞书登录默认角色，无菜单权限', true
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'pending');


-- ============================================================
-- migration: 0018_audit_logs.sql
-- source: /packages/db/drizzle/0018_audit_logs.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "user_name" varchar(100),
  "user_email" varchar(200),
  "action" varchar(100) NOT NULL,
  "resource_type" varchar(50),
  "resource_id" varchar(100),
  "detail" text,
  "ip_address" varchar(64),
  "user_agent" varchar(500),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" ("action");

INSERT INTO "menus" ("code", "name", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'system.logs', '操作日志', 'ScrollText', '/system/logs', p."id", 3, true
FROM "menus" p
WHERE p."code" = 'system'
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE m."code" = 'system.logs'
  AND r."code" = 'super_admin'
ON CONFLICT ("role_id", "menu_id") DO NOTHING;


-- ============================================================
-- migration: 0019_supply_chain_replenishment.sql
-- source: /packages/db/drizzle/0019_supply_chain_replenishment.sql
-- ============================================================

-- 供应链周期与补货健康度（阶段一）

DO $$ BEGIN
  CREATE TYPE "inventory_health" AS ENUM ('red', 'yellow', 'healthy', 'overstock');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "production_lead_days" integer DEFAULT 50 NOT NULL;

ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "shipping_lead_days" integer;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "inbound_buffer_days" integer DEFAULT 7 NOT NULL;

UPDATE "warehouses" SET "shipping_lead_days" = 45, "inbound_buffer_days" = 7 WHERE "code" = 'US-WEST' AND "shipping_lead_days" IS NULL;
UPDATE "warehouses" SET "shipping_lead_days" = 60, "inbound_buffer_days" = 7 WHERE "code" IN ('US-EAST', 'US-SOUTH', 'US-SOUTHEAST') AND "shipping_lead_days" IS NULL;
UPDATE "warehouses" SET "shipping_lead_days" = 80, "inbound_buffer_days" = 7 WHERE "code" = 'DE' AND "shipping_lead_days" IS NULL;
UPDATE "warehouses" SET "shipping_lead_days" = 75, "inbound_buffer_days" = 7 WHERE "code" = 'UK' AND "shipping_lead_days" IS NULL;

ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "safety_stock_days" integer DEFAULT 14;
ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "target_coverage_days" integer;
ALTER TABLE "safety_stock_config" ADD COLUMN IF NOT EXISTS "overstock_threshold_days" integer DEFAULT 180;

ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "health_status" "inventory_health";
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "coverage_days" numeric(10, 2);
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "total_lead_days" integer;
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "latest_order_days" numeric(10, 2);
ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "metrics" jsonb;

CREATE TABLE IF NOT EXISTS "purchase_follow_up_reminders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" uuid NOT NULL REFERENCES "purchase_drafts"("id") ON DELETE CASCADE,
  "milestone" varchar(10) NOT NULL,
  "due_date" date NOT NULL,
  "notified_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_follow_up_reminders_draft_milestone_idx"
  ON "purchase_follow_up_reminders" ("draft_id", "milestone");


-- ============================================================
-- migration: 0020_sales_forecast_monthly.sql
-- source: /packages/db/drizzle/0020_sales_forecast_monthly.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS "sales_forecast_monthly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "station" varchar(20) NOT NULL,
  "forecast_year" integer NOT NULL,
  "month" integer NOT NULL,
  "forecast_daily_avg" numeric(12, 4) NOT NULL,
  "lifecycle" varchar(50),
  "owner_name" varchar(100),
  "source" "data_source" DEFAULT 'import' NOT NULL,
  "import_batch_id" uuid,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_monthly_sku_station_month_idx"
  ON "sales_forecast_monthly" ("sku_id", "station", "forecast_year", "month");

CREATE INDEX IF NOT EXISTS "sales_forecast_monthly_sku_station_idx"
  ON "sales_forecast_monthly" ("sku_id", "station");


-- ============================================================
-- migration: 0021_sku_encoding.sql
-- source: /packages/db/drizzle/0021_sku_encoding.sql
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "sku_kind" AS ENUM ('standard', 'accessory', 'multi_box', 'return', 'legacy');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "division_code" varchar(1);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "distribution_no" integer DEFAULT 0;
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "spu_numeric_code" varchar(5);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "brand_code" varchar(2);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "category_code" varchar(3);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "division_name" varchar(50);
ALTER TABLE "spus" ADD COLUMN IF NOT EXISTS "encoding_source" varchar(20) DEFAULT 'manual';

ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "external_code" varchar(20);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "internal_code" varchar(12);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "sku_kind" "sku_kind" DEFAULT 'legacy';
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "division_code" varchar(1);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "distribution_no" integer;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "spu_numeric_code" varchar(5);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "variant_no" varchar(2);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "brand_code" varchar(2);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "category_code" varchar(3);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "factory_suffix" varchar(1);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "accessory_no" varchar(3);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "box_no" varchar(1);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "encoding_valid" boolean DEFAULT false NOT NULL;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "encoding_meta" jsonb;

CREATE INDEX IF NOT EXISTS "spus_division_spu_numeric_idx" ON "spus" ("division_code", "spu_numeric_code");
CREATE INDEX IF NOT EXISTS "skus_internal_code_idx" ON "skus" ("internal_code");
CREATE INDEX IF NOT EXISTS "skus_external_code_idx" ON "skus" ("external_code");


-- ============================================================
-- migration: 0022_inventory_health_lights.sql
-- source: /packages/db/drizzle/0022_inventory_health_lights.sql
-- ============================================================

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


-- ============================================================
-- migration: 0023_inventory_ops_production.sql
-- source: /packages/db/drizzle/0023_inventory_ops_production.sql
-- ============================================================

-- 库存健康快照、异常处置、补货/预警幂等字段

DO $$ BEGIN
  CREATE TYPE "inventory_exception_type" AS ENUM('stockout', 'overstock', 'slow_moving', 'lifecycle_eol');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "inventory_exception_status" AS ENUM('open', 'in_progress', 'resolved', 'dismissed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "inventory_health_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id"),
  "warehouse_code" varchar(100) NOT NULL,
  "health_status" "inventory_health" NOT NULL,
  "coverage_days" numeric(10, 2),
  "effective_qty" integer NOT NULL DEFAULT 0,
  "avg_daily" numeric(12, 4) NOT NULL DEFAULT 0,
  "demand_source" varchar(20) NOT NULL DEFAULT 'historical',
  "total_lead_days" integer,
  "latest_order_days" numeric(10, 2),
  "metrics" jsonb,
  "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "run_id" uuid
);

CREATE INDEX IF NOT EXISTS "inventory_health_snapshots_sku_wh_idx"
  ON "inventory_health_snapshots" ("sku_id", "warehouse_code", "computed_at" DESC);

CREATE INDEX IF NOT EXISTS "inventory_health_snapshots_health_idx"
  ON "inventory_health_snapshots" ("health_status", "computed_at" DESC);

CREATE TABLE IF NOT EXISTS "inventory_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id"),
  "warehouse_code" varchar(100) NOT NULL,
  "exception_type" "inventory_exception_type" NOT NULL,
  "health_status" "inventory_health" NOT NULL,
  "recommended_action" text,
  "status" "inventory_exception_status" NOT NULL DEFAULT 'open',
  "owner_id" uuid REFERENCES "users"("id"),
  "due_date" date,
  "resolved_by" uuid REFERENCES "users"("id"),
  "resolved_at" timestamp with time zone,
  "resolution_note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "inventory_exceptions_status_idx"
  ON "inventory_exceptions" ("status", "due_date");

CREATE INDEX IF NOT EXISTS "inventory_exceptions_sku_wh_type_idx"
  ON "inventory_exceptions" ("sku_id", "warehouse_code", "exception_type", "status");

ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;

ALTER TABLE "stock_alerts" ADD COLUMN IF NOT EXISTS "resolved_by" uuid REFERENCES "users"("id");


-- ============================================================
-- migration: 0024_sales_forecast_platform.sql
-- source: /packages/db/drizzle/0024_sales_forecast_platform.sql
-- ============================================================

-- 销售预测增加在售平台维度

ALTER TABLE "sales_forecast_monthly"
  ADD COLUMN IF NOT EXISTS "platform" varchar(50) NOT NULL DEFAULT 'ALL';

DROP INDEX IF EXISTS "sales_forecast_monthly_sku_station_month_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_monthly_sku_station_platform_month_idx"
  ON "sales_forecast_monthly" ("sku_id", "station", "platform", "forecast_year", "month");

CREATE INDEX IF NOT EXISTS "sales_forecast_monthly_platform_idx"
  ON "sales_forecast_monthly" ("platform", "station");


-- ============================================================
-- migration: 0025_sales_forecast_management.sql
-- source: /packages/db/drizzle/0025_sales_forecast_management.sql
-- ============================================================

-- 销售预测管理：平台字典、版本、调整元数据、准确率

DO $$ BEGIN
  CREATE TYPE "forecast_version_status" AS ENUM('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "forecast_confidence_level" AS ENUM('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "sales_platforms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "station" varchar(20),
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sales_platform_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "alias" varchar(100) NOT NULL UNIQUE,
  "platform_code" varchar(50) NOT NULL REFERENCES "sales_platforms"("code"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sales_forecast_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_no" varchar(50) NOT NULL UNIQUE,
  "version_name" varchar(200) NOT NULL,
  "station" varchar(20),
  "status" "forecast_version_status" NOT NULL DEFAULT 'draft',
  "created_by" uuid REFERENCES "users"("id"),
  "published_by" uuid REFERENCES "users"("id"),
  "published_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sales_forecast_versions_status_idx"
  ON "sales_forecast_versions" ("status", "station");

ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "version_id" uuid REFERENCES "sales_forecast_versions"("id");
ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "baseline_daily_avg" numeric(12, 4);
ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "manual_daily_avg" numeric(12, 4);
ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "adjust_reason" varchar(200);
ALTER TABLE "sales_forecast_monthly" ADD COLUMN IF NOT EXISTS "confidence_level" "forecast_confidence_level";

DROP INDEX IF EXISTS "sales_forecast_monthly_sku_station_platform_month_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_monthly_version_unique_idx"
  ON "sales_forecast_monthly" ("sku_id", "station", "platform", "forecast_year", "month", "version_id");

CREATE TABLE IF NOT EXISTS "forecast_accuracy_monthly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "station" varchar(20) NOT NULL,
  "platform" varchar(50) NOT NULL DEFAULT 'ALL',
  "forecast_year" integer NOT NULL,
  "month" integer NOT NULL,
  "forecast_daily_avg" numeric(12, 4) NOT NULL,
  "actual_daily_avg" numeric(12, 4) NOT NULL,
  "bias_rate" numeric(10, 4),
  "mape" numeric(10, 4),
  "version_id" uuid REFERENCES "sales_forecast_versions"("id"),
  "computed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "forecast_accuracy_monthly_unique_idx"
  ON "forecast_accuracy_monthly" ("sku_id", "station", "platform", "forecast_year", "month", "version_id");

-- 默认平台与初始发布版本
INSERT INTO "sales_platforms" ("code", "name", "station", "sort_order")
VALUES
  ('ALL', '全平台汇总', NULL, 0),
  ('AMAZON', '亚马逊', 'US', 10),
  ('WALMART', '沃尔玛', 'US', 20),
  ('EBAY', 'eBay', 'US', 30),
  ('SHOPIFY', '独立站', NULL, 40),
  ('DTC', '品牌站', NULL, 50),
  ('TIKTOK', 'TikTok Shop', 'US', 60),
  ('TEMU', 'Temu', 'US', 70)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "sales_platform_aliases" ("alias", "platform_code")
VALUES
  ('亚马逊', 'AMAZON'),
  ('AMZ', 'AMAZON'),
  ('沃尔玛', 'WALMART'),
  ('独立站', 'DTC'),
  ('全平台', 'ALL')
ON CONFLICT ("alias") DO NOTHING;

INSERT INTO "sales_forecast_versions" ("id", "version_no", "version_name", "status", "published_at")
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'LEGACY-001',
  '历史导入默认版本',
  'published'::"forecast_version_status",
  now()
WHERE NOT EXISTS (SELECT 1 FROM "sales_forecast_versions" WHERE "version_no" = 'LEGACY-001');

UPDATE "sales_forecast_monthly"
SET "version_id" = '00000000-0000-0000-0000-000000000001'::uuid
WHERE "version_id" IS NULL;


-- ============================================================
-- migration: 0026_widen_spu_numeric_code.sql
-- source: /packages/db/drizzle/0026_widen_spu_numeric_code.sql
-- ============================================================

-- Legacy DJ SPU 序号可达 6 位（如 502313），原 varchar(5) 导致 SKU 导入 500
ALTER TABLE "spus" ALTER COLUMN "spu_numeric_code" TYPE varchar(10);
ALTER TABLE "skus" ALTER COLUMN "spu_numeric_code" TYPE varchar(10);


-- ============================================================
-- migration: 0027_widen_variant_no.sql
-- source: /packages/db/drizzle/0027_widen_variant_no.sql
-- ============================================================

-- Legacy DJ 变参可达 3 位及以上（如 DJ502313_342），原 varchar(2) 导致 SKU 导入失败
ALTER TABLE "skus" ALTER COLUMN "variant_no" TYPE varchar(10);


-- ============================================================
-- migration: 0028_ai_runs.sql
-- source: /packages/db/drizzle/0028_ai_runs.sql
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "public"."ai_run_status" AS ENUM('running', 'success', 'failed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ai_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "graph_name" varchar(100) NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "conversation_id" uuid REFERENCES "kb_conversations"("id") ON DELETE SET NULL,
  "triggered_by" varchar(200),
  "status" "ai_run_status" DEFAULT 'running' NOT NULL,
  "input" jsonb,
  "output" jsonb,
  "error_message" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "ai_run_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "ai_runs"("id") ON DELETE CASCADE,
  "node_name" varchar(100) NOT NULL,
  "status" "ai_run_status" DEFAULT 'running' NOT NULL,
  "input" jsonb,
  "output" jsonb,
  "error_message" text,
  "duration_ms" integer,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "ai_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "ai_runs"("id") ON DELETE CASCADE,
  "step_id" uuid REFERENCES "ai_run_steps"("id") ON DELETE SET NULL,
  "tool_name" varchar(100) NOT NULL,
  "input" jsonb,
  "output" jsonb,
  "error_message" text,
  "duration_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_runs_graph_started_idx" ON "ai_runs" ("graph_name", "started_at");
CREATE INDEX IF NOT EXISTS "ai_runs_user_idx" ON "ai_runs" ("user_id");
CREATE INDEX IF NOT EXISTS "ai_run_steps_run_idx" ON "ai_run_steps" ("run_id");
CREATE INDEX IF NOT EXISTS "ai_tool_calls_run_idx" ON "ai_tool_calls" ("run_id");
CREATE INDEX IF NOT EXISTS "ai_tool_calls_tool_idx" ON "ai_tool_calls" ("tool_name");


-- ============================================================
-- migration: 0029_purchase_tracking_lifecycle.sql
-- source: /packages/db/drizzle/0029_purchase_tracking_lifecycle.sql
-- ============================================================

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


-- ============================================================
-- migration: 0030_sales_forecast_collaboration.sql
-- source: /packages/db/drizzle/0030_sales_forecast_collaboration.sql
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "forecast_source_batch_status" AS ENUM ('uploaded', 'parsed', 'generated', 'failed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_review_issue_type" AS ENUM (
    'high_value',
    'trend_shift',
    'stockout_suspected',
    'category_deviation',
    'low_accuracy',
    'missing_history',
    'platform_mix'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_review_severity" AS ENUM ('critical', 'warning', 'info');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_review_status" AS ENUM ('pending', 'reviewed', 'ignored');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_seasonality_dimension_type" AS ENUM ('category', 'project_group');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_forecast_source_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_no" varchar(50) NOT NULL UNIQUE,
  "daily_file_name" varchar(255),
  "monthly_file_name" varchar(255),
  "daily_start_date" date,
  "daily_end_date" date,
  "monthly_start_month" varchar(7),
  "monthly_end_month" varchar(7),
  "sku_count" integer NOT NULL DEFAULT 0,
  "row_count" integer NOT NULL DEFAULT 0,
  "status" "forecast_source_batch_status" NOT NULL DEFAULT 'uploaded',
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_forecast_review_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version_id" uuid NOT NULL REFERENCES "sales_forecast_versions"("id") ON DELETE CASCADE,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "station" varchar(20) NOT NULL,
  "platform" varchar(50) NOT NULL DEFAULT 'ALL',
  "issue_type" "forecast_review_issue_type" NOT NULL,
  "severity" "forecast_review_severity" NOT NULL,
  "message" text NOT NULL,
  "suggested_daily_avg" numeric(12, 4),
  "reviewed_daily_avg" numeric(12, 4),
  "status" "forecast_review_status" NOT NULL DEFAULT 'pending',
  "reviewer_id" uuid REFERENCES "users"("id"),
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_forecast_review_items_version_status_idx"
  ON "sales_forecast_review_items" ("version_id", "status", "severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_forecast_review_items_sku_idx"
  ON "sales_forecast_review_items" ("sku_id", "station", "platform");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_review_items_identity_unique_idx"
  ON "sales_forecast_review_items" ("version_id", "sku_id", "station", "platform", "issue_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_forecast_seasonality" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dimension_type" "forecast_seasonality_dimension_type" NOT NULL,
  "dimension_value" varchar(200) NOT NULL,
  "month" integer NOT NULL,
  "seasonality_factor" numeric(10, 4) NOT NULL,
  "trend_factor" numeric(10, 4),
  "source_batch_id" uuid REFERENCES "sales_forecast_source_batches"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecast_seasonality_unique_idx"
  ON "sales_forecast_seasonality" ("dimension_type", "dimension_value", "month");


-- ============================================================
-- migration: 0031_sales_history_monthly.sql
-- source: /packages/db/drizzle/0031_sales_history_monthly.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS "sales_history_monthly" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "channel" varchar(100) NOT NULL DEFAULT 'UNKNOWN',
  "sale_year" integer NOT NULL,
  "month" integer NOT NULL,
  "qty_sold" integer NOT NULL,
  "source" "data_source" NOT NULL DEFAULT 'import',
  "import_batch_id" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_history_monthly_sku_channel_month_unique_idx"
  ON "sales_history_monthly" ("sku_id", "channel", "sale_year", "month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_history_monthly_sku_year_month_idx"
  ON "sales_history_monthly" ("sku_id", "sale_year", "month");


-- ============================================================
-- migration: 0032_sku_inventory_master_fields.sql
-- source: /packages/db/drizzle/0032_sku_inventory_master_fields.sql
-- ============================================================

-- 库存周转表 A:K → SKU 主数据字段
ALTER TABLE "skus" ALTER COLUMN "category" TYPE varchar(500);

ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "lifecycle" varchar(50);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "sales_country" varchar(100);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "product_category" varchar(200);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "owner_name" varchar(100);
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "developer_name" varchar(100);


-- ============================================================
-- migration: 0033_turnover_bucket_warehouses.sql
-- source: /packages/db/drizzle/0033_turnover_bucket_warehouses.sql
-- ============================================================

-- 周转表分区仓：美中 / 平台仓（inventory_records 分仓写入，不参与 FOB 合并）
INSERT INTO "warehouses" ("code", "name", "region_group", "country_code", "allow_cross_fulfill", "sort_order")
VALUES
  ('US-CENTRAL', '美中仓', 'US', 'US', true, 7),
  ('PLATFORM-US', '平台仓(美)', 'US', 'US', true, 8),
  ('PLATFORM-EU', '平台仓(欧)', 'EU', 'EU', true, 9)
ON CONFLICT ("code") DO NOTHING;


-- ============================================================
-- migration: 0034_sales_history_category.sql
-- source: /packages/db/drizzle/0034_sales_history_category.sql
-- ============================================================

ALTER TABLE "sales_history" ADD COLUMN IF NOT EXISTS "category" varchar(200);
ALTER TABLE "sales_history_monthly" ADD COLUMN IF NOT EXISTS "category" varchar(200);

CREATE INDEX IF NOT EXISTS "sales_history_category_idx" ON "sales_history" ("category");

UPDATE "sales_history" sh
SET "category" = s."category"
FROM "skus" s
WHERE sh."sku_id" = s."id"
  AND sh."category" IS NULL
  AND s."category" IS NOT NULL;

UPDATE "sales_history_monthly" shm
SET "category" = s."category"
FROM "skus" s
WHERE shm."sku_id" = s."id"
  AND shm."category" IS NULL
  AND s."category" IS NOT NULL;


-- ============================================================
-- migration: 0035_news_intel.sql
-- source: /packages/db/drizzle/0035_news_intel.sql
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "news_source_type" AS ENUM('rss', 'rsshub', 'manual');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "news_category" AS ENUM(
    'supply_chain',
    'logistics',
    'customs',
    'platform_policy',
    'operations',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "news_priority" AS ENUM('high', 'medium', 'low');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "news_article_status" AS ENUM('pending_review', 'published', 'ignored', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "news_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL,
  "name" varchar(200) NOT NULL,
  "feed_url" text NOT NULL,
  "source_type" "news_source_type" DEFAULT 'rss' NOT NULL,
  "category_default" "news_category" DEFAULT 'other' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "fetch_interval_hours" integer DEFAULT 12 NOT NULL,
  "last_fetched_at" timestamptz,
  "last_error" text,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "config_json" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "news_sources_code_idx" ON "news_sources" ("code");
CREATE INDEX IF NOT EXISTS "news_sources_enabled_fetched_idx" ON "news_sources" ("enabled", "last_fetched_at");

CREATE TABLE IF NOT EXISTS "news_articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid NOT NULL REFERENCES "news_sources"("id") ON DELETE CASCADE,
  "canonical_url" text NOT NULL,
  "url_hash" varchar(64) NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "body_text" text,
  "key_points" jsonb,
  "category" "news_category" DEFAULT 'other' NOT NULL,
  "tags" text[],
  "relevance_score" integer DEFAULT 0 NOT NULL,
  "priority" "news_priority" DEFAULT 'low' NOT NULL,
  "status" "news_article_status" DEFAULT 'pending_review' NOT NULL,
  "published_at" timestamptz,
  "fetched_at" timestamptz DEFAULT now() NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "affected_platforms" text[],
  "affected_regions" text[],
  "language" varchar(10),
  "bitable_record_id" varchar(100),
  "bitable_synced_at" timestamptz,
  "ingest_run_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "news_articles_url_hash_idx" ON "news_articles" ("url_hash");
CREATE INDEX IF NOT EXISTS "news_articles_content_hash_idx" ON "news_articles" ("content_hash");
CREATE INDEX IF NOT EXISTS "news_articles_status_priority_idx" ON "news_articles" ("status", "priority", "published_at");
CREATE INDEX IF NOT EXISTS "news_articles_source_fetched_idx" ON "news_articles" ("source_id", "fetched_at");

CREATE TABLE IF NOT EXISTS "news_ingest_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid NOT NULL REFERENCES "news_sources"("id") ON DELETE CASCADE,
  "task_run_id" uuid,
  "fetched_count" integer DEFAULT 0 NOT NULL,
  "new_count" integer DEFAULT 0 NOT NULL,
  "skipped_dup" integer DEFAULT 0 NOT NULL,
  "skipped_low_relevance" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "duration_ms" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "news_ingest_logs_source_created_idx" ON "news_ingest_logs" ("source_id", "created_at");


-- ============================================================
-- migration: 0036_news_article_bitable_category.sql
-- source: /packages/db/drizzle/0036_news_article_bitable_category.sql
-- ============================================================

ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "bitable_category" varchar(50);
CREATE INDEX IF NOT EXISTS "news_articles_bitable_category_idx" ON "news_articles" ("bitable_category");


-- ============================================================
-- migration: 0037_sales_history_import_perf.sql
-- source: /packages/db/drizzle/0037_sales_history_import_perf.sql
-- ============================================================

-- 销量日表：去重约束 + 导入/查询常用索引（支撑千万级写入与按日筛选）
CREATE UNIQUE INDEX IF NOT EXISTS "sales_history_sku_date_channel_unique_idx"
  ON "sales_history" ("sku_id", "sale_date", "channel");

CREATE INDEX IF NOT EXISTS "sales_history_sale_date_idx"
  ON "sales_history" ("sale_date");

CREATE INDEX IF NOT EXISTS "sales_history_import_batch_id_idx"
  ON "sales_history" ("import_batch_id")
  WHERE "import_batch_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "sales_history_source_sku_date_idx"
  ON "sales_history" ("source", "sku_id", "sale_date");


-- ============================================================
-- migration: 0038_forecast_horizon_factors.sql
-- source: /packages/db/drizzle/0038_forecast_horizon_factors.sql
-- ============================================================

ALTER TABLE "sales_forecast_monthly"
  ADD COLUMN IF NOT EXISTS "horizon_factors" jsonb;


-- ============================================================
-- migration: 0039_forecast_eligibility.sql
-- source: /packages/db/drizzle/0039_forecast_eligibility.sql
-- ============================================================

ALTER TYPE forecast_review_issue_type ADD VALUE IF NOT EXISTS 'forecast_skipped';
--> statement-breakpoint
ALTER TABLE skus ADD COLUMN IF NOT EXISTS force_forecast boolean NOT NULL DEFAULT false;


-- ============================================================
-- migration: 0040_forecast_profile_horizon.sql
-- source: /packages/db/drizzle/0040_forecast_profile_horizon.sql
-- ============================================================

ALTER TYPE "forecast_review_issue_type" ADD VALUE IF NOT EXISTS 'precision_review';

ALTER TABLE "sales_forecast_monthly"
  ADD COLUMN IF NOT EXISTS "forecast_profile_class" varchar(1),
  ADD COLUMN IF NOT EXISTS "profile_segment" varchar(20),
  ADD COLUMN IF NOT EXISTS "horizon_band" varchar(20),
  ADD COLUMN IF NOT EXISTS "continuity_12m" numeric(8, 4),
  ADD COLUMN IF NOT EXISTS "cv_12m" numeric(8, 4),
  ADD COLUMN IF NOT EXISTS "forecast_daily_p10" numeric(12, 4),
  ADD COLUMN IF NOT EXISTS "forecast_daily_p90" numeric(12, 4),
  ADD COLUMN IF NOT EXISTS "forecast_model" varchar(50);

CREATE TABLE IF NOT EXISTS "forecast_promo_calendar" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "station" varchar(20) NOT NULL,
  "platform" varchar(50) NOT NULL DEFAULT 'ALL',
  "promo_year" integer NOT NULL,
  "promo_month" integer NOT NULL,
  "intensity" numeric(6, 4) NOT NULL DEFAULT 1,
  "label" varchar(200),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "forecast_promo_calendar_unique_idx"
  ON "forecast_promo_calendar" ("station", "platform", "promo_year", "promo_month");


-- ============================================================
-- migration: 0041_forecast_exogenous_flags.sql
-- source: /packages/db/drizzle/0041_forecast_exogenous_flags.sql
-- ============================================================

-- 外生冲击标记：广告/调价等，准确率统计时剔除
DO $$ BEGIN
  ALTER TYPE "forecast_review_issue_type" ADD VALUE IF NOT EXISTS 'exogenous_shock';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "forecast_exogenous_reason" AS ENUM (
    'ad',
    'price_change',
    'promo',
    'listing_change',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forecast_exogenous_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sku_id" uuid NOT NULL REFERENCES "skus"("id") ON DELETE CASCADE,
  "station" varchar(20) NOT NULL DEFAULT 'US',
  "platform" varchar(50) NOT NULL DEFAULT 'ALL',
  "flag_year" integer,
  "flag_month" integer,
  "reason" "forecast_exogenous_reason" NOT NULL DEFAULT 'other',
  "note" text,
  "exclude_from_kpi" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecast_exogenous_flags_sku_station_idx"
  ON "forecast_exogenous_flags" ("sku_id", "station", "platform");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forecast_exogenous_flags_unique_idx"
  ON "forecast_exogenous_flags" ("sku_id", "station", "platform", "flag_year", "flag_month", "reason");


-- ============================================================
-- migration: 0042_cs_reply_quality.sql
-- source: /packages/db/drizzle/0042_cs_reply_quality.sql
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "cs_reply_batch_status" AS ENUM('importing', 'imported', 'scoring', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "cs_reply_score_status" AS ENUM('pending', 'scoring', 'scored', 'failed', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "cs_reply_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_no" varchar(32) NOT NULL,
  "name" varchar(200),
  "status" "cs_reply_batch_status" DEFAULT 'importing' NOT NULL,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "imported_rows" integer DEFAULT 0 NOT NULL,
  "scored_rows" integer DEFAULT 0 NOT NULL,
  "failed_rows" integer DEFAULT 0 NOT NULL,
  "pass_threshold" integer DEFAULT 70 NOT NULL,
  "error_summary" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cs_reply_batches_status_created_idx" ON "cs_reply_batches" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "cs_reply_batches_batch_no_idx" ON "cs_reply_batches" ("batch_no");

CREATE TABLE IF NOT EXISTS "cs_reply_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL REFERENCES "cs_reply_batches"("id") ON DELETE CASCADE,
  "row_no" integer NOT NULL,
  "buyer_email" varchar(256),
  "sent_at" timestamptz,
  "agent_name" varchar(64),
  "message_type" varchar(32),
  "order_no" varchar(64),
  "buyer_message" text NOT NULL,
  "agent_reply" text NOT NULL,
  "score_status" "cs_reply_score_status" DEFAULT 'pending' NOT NULL,
  "overall_score" integer,
  "score_detail" jsonb,
  "feedback" text,
  "highlights" jsonb,
  "issues" jsonb,
  "pass" boolean,
  "error_message" text,
  "scored_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cs_reply_records_batch_row_idx" ON "cs_reply_records" ("batch_id", "row_no");
CREATE INDEX IF NOT EXISTS "cs_reply_records_batch_score_idx" ON "cs_reply_records" ("batch_id", "score_status");
CREATE INDEX IF NOT EXISTS "cs_reply_records_agent_idx" ON "cs_reply_records" ("agent_name");
CREATE INDEX IF NOT EXISTS "cs_reply_records_sent_at_idx" ON "cs_reply_records" ("sent_at");

-- 客服管理菜单
INSERT INTO "menus" ("code", "name", "icon", "path", "sort_order", "is_leaf")
VALUES ('cs', '客服管理', 'Headphones', NULL, 3, false)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "icon" = EXCLUDED."icon",
  "sort_order" = EXCLUDED."sort_order",
  "is_leaf" = EXCLUDED."is_leaf";

INSERT INTO "menus" ("code", "name", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'cs.quality', '回复质量评估', 'MailCheck', '/cs/quality', p."id", 1, true
FROM "menus" p
WHERE p."code" = 'cs'
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "icon" = EXCLUDED."icon",
  "path" = EXCLUDED."path",
  "parent_id" = EXCLUDED."parent_id",
  "sort_order" = EXCLUDED."sort_order",
  "is_leaf" = EXCLUDED."is_leaf";

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE m."code" IN ('cs', 'cs.quality')
  AND r."code" IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;


-- ============================================================
-- migration: 0043_cs_reply_menu_rename.sql
-- source: /packages/db/drizzle/0043_cs_reply_menu_rename.sql
-- ============================================================

UPDATE "menus"
SET "name" = '回复评分'
WHERE "code" = 'cs.quality';


-- ============================================================
-- migration: 0044_procurement_module.sql
-- source: /packages/db/drizzle/0044_procurement_module.sql
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "public"."procurement_list_type" AS ENUM('bulk_stock_request', 'purchase_follow_up');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "procurement_list_meta" (
  "list_type" "procurement_list_type" PRIMARY KEY NOT NULL,
  "column_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "row_count" integer DEFAULT 0 NOT NULL,
  "last_sync_at" timestamp with time zone,
  "last_sync_source" varchar(20),
  "last_sync_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "procurement_list_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "list_type" "procurement_list_type" NOT NULL,
  "row_index" integer NOT NULL,
  "bitable_record_id" varchar(100),
  "row_data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "procurement_list_meta"
    ADD CONSTRAINT "procurement_list_meta_last_sync_by_users_id_fk"
    FOREIGN KEY ("last_sync_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "procurement_list_rows_list_type_idx" ON "procurement_list_rows" ("list_type");
CREATE INDEX IF NOT EXISTS "procurement_list_rows_list_type_row_index_idx" ON "procurement_list_rows" ("list_type", "row_index");

INSERT INTO "menus" ("name", "code", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT '采购管理', 'procurement', 'ShoppingCart', NULL, NULL, 3, false
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE "code" = 'procurement');

INSERT INTO "menus" ("name", "code", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT '大件备货申请', 'procurement.bulk_stock', NULL, '/procurement/bulk-stock',
  (SELECT id FROM "menus" WHERE code = 'procurement' LIMIT 1), 1, true
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE "code" = 'procurement.bulk_stock');

INSERT INTO "menus" ("name", "code", "icon", "path", "parent_id", "sort_order", "is_leaf")
SELECT '采购跟单', 'procurement.follow_up', NULL, '/procurement/follow-up',
  (SELECT id FROM "menus" WHERE code = 'procurement' LIMIT 1), 2, true
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE "code" = 'procurement.follow_up');

UPDATE "menus" SET "sort_order" = 4 WHERE "code" = 'cs';
UPDATE "menus" SET "sort_order" = 5 WHERE "code" = 'logistics';
UPDATE "menus" SET "sort_order" = 6 WHERE "code" = 'ai';
UPDATE "menus" SET "sort_order" = 7 WHERE "code" = 'data';

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r.id, m.id FROM "roles" r, "menus" m
WHERE r.code = 'super_admin' AND m.code IN ('procurement', 'procurement.bulk_stock', 'procurement.follow_up')
  AND NOT EXISTS (
    SELECT 1 FROM "role_menus" rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r.id, m.id FROM "roles" r, "menus" m
WHERE r.code = 'purchaser' AND m.code IN ('procurement', 'procurement.bulk_stock', 'procurement.follow_up')
  AND NOT EXISTS (
    SELECT 1 FROM "role_menus" rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r.id, m.id FROM "roles" r, "menus" m
WHERE r.code = 'pmc_planner' AND m.code IN ('procurement', 'procurement.bulk_stock')
  AND NOT EXISTS (
    SELECT 1 FROM "role_menus" rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );

INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r.id, m.id FROM "roles" r, "menus" m
WHERE r.code = 'viewer' AND m.code IN ('procurement', 'procurement.bulk_stock', 'procurement.follow_up')
  AND NOT EXISTS (
    SELECT 1 FROM "role_menus" rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );


-- ============================================================
-- migration: 0045_news_intel_v2.sql
-- source: /packages/db/drizzle/0045_news_intel_v2.sql
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "news_source_tier" AS ENUM('tier_1', 'tier_2', 'tier_3');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "news_bitable_sync_status" AS ENUM('pending', 'synced', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "news_business_validity" AS ENUM('valid', 'invalid', 'misclassified');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "news_sources" ADD COLUMN IF NOT EXISTS "source_tier" "news_source_tier" DEFAULT 'tier_2' NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_sources" ADD COLUMN IF NOT EXISTS "is_official" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_sources" ADD COLUMN IF NOT EXISTS "source_language" varchar(10) DEFAULT 'zh' NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_sources" ADD COLUMN IF NOT EXISTS "scope_json" jsonb;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "title_zh" text;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "title_original" text;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "topic_category" varchar(80);
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "departments" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "platform_tags" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "country_tags" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "business_tags" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "brand_tags" text[];
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "source_tier" "news_source_tier";
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "is_official_source" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "filter_hits" text;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "business_validity" "news_business_validity" DEFAULT 'valid' NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "bitable_sync_status" "news_bitable_sync_status" DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_articles" ADD COLUMN IF NOT EXISTS "bitable_sync_error" text;
--> statement-breakpoint
ALTER TABLE "news_ingest_logs" ADD COLUMN IF NOT EXISTS "skipped_filtered" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_ingest_logs" ADD COLUMN IF NOT EXISTS "translated_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "news_ingest_logs" ADD COLUMN IF NOT EXISTS "bitable_sync_failed_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "news_articles"
SET "title_zh" = COALESCE("title_zh", "title"),
    "title_original" = COALESCE("title_original", "title")
WHERE "title_zh" IS NULL OR "title_original" IS NULL;
--> statement-breakpoint
UPDATE "news_articles"
SET "bitable_sync_status" = 'synced'
WHERE "bitable_record_id" IS NOT NULL AND "bitable_sync_status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_sources_tier_enabled_idx" ON "news_sources" ("source_tier", "enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_articles_sync_status_idx" ON "news_articles" ("bitable_sync_status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_articles_topic_category_idx" ON "news_articles" ("topic_category");


-- ============================================================
-- migration: 0046_news_intel_menu.sql
-- source: /packages/db/drizzle/0046_news_intel_menu.sql
-- ============================================================

-- 跨境资讯管理菜单（仅 super_admin）

INSERT INTO "menus" ("code", "name", "icon", "sort_order", "is_leaf")
VALUES ('intel', '跨境资讯', 'Newspaper', 8, false)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "menus" ("code", "name", "path", "parent_id", "sort_order", "is_leaf")
SELECT 'intel.news', '资讯采集', '/intel/news', p."id", 1, true
FROM "menus" p WHERE p."code" = 'intel'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
CROSS JOIN "menus" m
WHERE r."code" = 'super_admin'
  AND m."code" IN ('intel', 'intel.news')
ON CONFLICT ("role_id", "menu_id") DO NOTHING;


-- ============================================================
-- seed: miaoda-seed-roles-menus.sql
-- source: /docs/sql/miaoda-seed-roles-menus.sql
-- ============================================================

-- Miaoda seed: roles, menus, role_menus, default admin
-- Prerequisite: drizzle migrations 0000-0012
-- Idempotent: safe to re-run (uses WHERE NOT EXISTS, no UNIQUE constraint required)

INSERT INTO roles (name, code, description, is_system) SELECT '超级管理员', 'super_admin', '管理角色/菜单/用户', true WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'super_admin');
INSERT INTO roles (name, code, description, is_system) SELECT 'PMC 计划员', 'pmc_planner', '管理 PMC 计划', true WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'pmc_planner');
INSERT INTO roles (name, code, description, is_system) SELECT '仓库员', 'warehouse', '录入库存/出入库', true WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'warehouse');
INSERT INTO roles (name, code, description, is_system) SELECT '采购员', 'purchaser', '管理采购/补货', true WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'purchaser');
INSERT INTO roles (name, code, description, is_system) SELECT '只读查看', 'viewer', '只读访问', true WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'viewer');

INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '经营看板', 'dashboard', 'LayoutDashboard', '/dashboard', NULL, 0, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'dashboard');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '库存管理', 'inventory', 'Package', NULL, NULL, 1, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '库存总览', 'inventory.overview', NULL, '/inventory/overview', (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.overview');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '安全库存设置', 'inventory.safety', NULL, '/inventory/safety', (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.safety');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '缺货预警', 'inventory.alert', NULL, '/inventory/alerts', (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 3, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.alert');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '下单计划', 'pmc', 'ClipboardList', NULL, NULL, 2, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'pmc');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '补货建议', 'pmc.suggestion', NULL, '/pmc/suggestions', (SELECT id FROM menus WHERE code = 'pmc' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'pmc.suggestion');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '计划列表', 'pmc.list', NULL, '/pmc/list', (SELECT id FROM menus WHERE code = 'pmc' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'pmc.list');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '采购跟单', 'pmc.tracking', NULL, '/pmc/tracking', (SELECT id FROM menus WHERE code = 'pmc' LIMIT 1), 3, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'pmc.tracking');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '采购管理', 'procurement', 'ShoppingCart', NULL, NULL, 3, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'procurement');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '大件备货申请', 'procurement.bulk_stock', NULL, '/procurement/bulk-stock', (SELECT id FROM menus WHERE code = 'procurement' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'procurement.bulk_stock');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '采购跟单', 'procurement.follow_up', NULL, '/procurement/follow-up', (SELECT id FROM menus WHERE code = 'procurement' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'procurement.follow_up');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '客服管理', 'cs', 'Headphones', NULL, NULL, 4, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'cs');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '回复评分', 'cs.quality', NULL, '/cs/quality', (SELECT id FROM menus WHERE code = 'cs' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'cs.quality');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '物流管理', 'logistics', 'Truck', NULL, NULL, 5, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'logistics');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT 'FOB分账', 'logistics.fob_settlement', NULL, '/logistics/fob-settlement', (SELECT id FROM menus WHERE code = 'logistics' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'logistics.fob_settlement');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT 'AI 知识库', 'ai', 'Bot', NULL, NULL, 6, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'ai');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '知识问答', 'ai.chat', NULL, '/ai/chat', (SELECT id FROM menus WHERE code = 'ai' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'ai.chat');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '数据中心', 'data', 'ClipboardList', NULL, NULL, 7, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '商品主数据', 'data.products', NULL, '/data/products', (SELECT id FROM menus WHERE code = 'data' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data.products');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '销量历史', 'data.sales', NULL, '/data/sales', (SELECT id FROM menus WHERE code = 'data' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data.sales');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '销售预测', 'data.forecast', NULL, '/data/forecast', (SELECT id FROM menus WHERE code = 'data' LIMIT 1), 3, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'data.forecast');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '跨境资讯', 'intel', 'Newspaper', NULL, NULL, 8, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'intel');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '资讯采集', 'intel.news', NULL, '/intel/news', (SELECT id FROM menus WHERE code = 'intel' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'intel.news');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '帮助中心', 'help', 'HelpCircle', '/help', NULL, 98, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'help');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '系统设置', 'system', 'Settings', NULL, NULL, 99, false WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '用户管理', 'system.users', NULL, '/system/users', (SELECT id FROM menus WHERE code = 'system' LIMIT 1), 1, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system.users');
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT '角色与菜单', 'system.roles', NULL, '/system/roles', (SELECT id FROM menus WHERE code = 'system' LIMIT 1), 2, true WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'system.roles');

INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'dashboard' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'inventory' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'inventory.overview' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'inventory.safety' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'inventory.alert' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'pmc' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'pmc.suggestion' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'pmc.list' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'pmc.tracking' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'procurement' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'procurement.bulk_stock' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'procurement.follow_up' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'cs' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'cs.quality' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'logistics' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'logistics.fob_settlement' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'data' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'data.products' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'data.sales' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'data.forecast' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'intel' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'intel.news' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'ai' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'ai.chat' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'help' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'system' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'system.users' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'super_admin' AND m.code = 'system.roles' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'dashboard' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'inventory' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'inventory.overview' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'inventory.safety' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'pmc' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'pmc.suggestion' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'pmc.list' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'procurement' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'procurement.bulk_stock' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'logistics' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'logistics.fob_settlement' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'cs' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'cs.quality' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'data' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'data.products' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'data.sales' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'data.forecast' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'ai' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'ai.chat' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'pmc_planner' AND m.code = 'help' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'dashboard' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'inventory' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'inventory.overview' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'inventory.alert' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'pmc' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'pmc.list' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'logistics' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'logistics.fob_settlement' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'cs' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'cs.quality' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'data' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'data.products' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'data.sales' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'data.forecast' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'ai' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'ai.chat' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'warehouse' AND m.code = 'help' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'dashboard' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'inventory' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'inventory.overview' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'inventory.safety' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'inventory.alert' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'pmc' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'pmc.list' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'pmc.tracking' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'procurement' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'procurement.bulk_stock' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'procurement.follow_up' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'logistics' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'logistics.fob_settlement' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'cs' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'cs.quality' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'data' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'data.products' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'data.sales' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'data.forecast' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'ai' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'ai.chat' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'purchaser' AND m.code = 'help' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'dashboard' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'inventory' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'inventory.overview' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'pmc' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'pmc.suggestion' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'pmc.list' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'pmc.tracking' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'procurement' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'procurement.bulk_stock' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'procurement.follow_up' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'logistics' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'logistics.fob_settlement' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'cs' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'cs.quality' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'data' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'data.sales' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'data.forecast' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'ai' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'ai.chat' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);
INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = 'viewer' AND m.code = 'help' AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);

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
