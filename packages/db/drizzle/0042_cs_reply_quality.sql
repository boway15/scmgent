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
