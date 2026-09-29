-- FOB 起运港主数据 + 货代规则按港 + 体积起运港
CREATE TABLE IF NOT EXISTS "fob_ports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "code" varchar(50),
  "is_active" boolean DEFAULT true NOT NULL,
  "remark" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "fob_ports_name_unique" UNIQUE("name"),
  CONSTRAINT "fob_ports_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_ports_active_idx" ON "fob_ports" USING btree ("is_active");
--> statement-breakpoint
INSERT INTO "fob_ports" ("name", "code", "is_active", "remark")
SELECT '模板港口', '__TEMPLATE__', true, '既有全局货代规则迁入此港；可复制到真实起运港'
WHERE NOT EXISTS (SELECT 1 FROM "fob_ports" WHERE "code" = '__TEMPLATE__');
--> statement-breakpoint
ALTER TABLE "fob_fee_allocation_rules" ADD COLUMN IF NOT EXISTS "port_id" uuid;
--> statement-breakpoint
UPDATE "fob_fee_allocation_rules" r
SET "port_id" = p."id"
FROM "fob_ports" p
WHERE p."code" = '__TEMPLATE__'
  AND r."source_bill_type" = 'freight'
  AND r."port_id" IS NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fob_fee_allocation_rules"
    ADD CONSTRAINT "fob_fee_allocation_rules_port_id_fob_ports_id_fk"
    FOREIGN KEY ("port_id") REFERENCES "public"."fob_ports"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fob_fee_allocation_rules_port_bill_idx"
  ON "fob_fee_allocation_rules" USING btree ("port_id", "source_bill_type", "is_active");
--> statement-breakpoint
ALTER TABLE "fob_merchant_shipments" ADD COLUMN IF NOT EXISTS "origin_port" varchar(100);
