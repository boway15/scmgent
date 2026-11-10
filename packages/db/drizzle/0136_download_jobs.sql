DO $$ BEGIN
  CREATE TYPE "download_job_status" AS ENUM (
    'pending',
    'running',
    'ready',
    'failed',
    'cancelled',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "download_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_by" uuid NOT NULL,
  "job_type" varchar(100) NOT NULL,
  "title" varchar(200) NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "params_json" text DEFAULT '{}' NOT NULL,
  "status" "download_job_status" DEFAULT 'pending' NOT NULL,
  "storage_path" varchar(500),
  "file_size" bigint,
  "content_type" varchar(120),
  "row_count" integer,
  "error_message" text,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "download_jobs_created_by_created_idx"
  ON "download_jobs" ("created_by", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "download_jobs_status_expires_idx"
  ON "download_jobs" ("status", "expires_at");
--> statement-breakpoint
INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
SELECT '下载中心', 'downloads', 'Download', '/downloads', NULL, 95, true
WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'downloads');
--> statement-breakpoint
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE m.code = 'downloads'
  AND r.code IN ('super_admin', 'pmc_planner', 'warehouse', 'purchaser', 'viewer')
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );
