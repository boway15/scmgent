CREATE TABLE IF NOT EXISTS "rule_param_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module_code" varchar(50) NOT NULL,
  "scope_type" varchar(20) NOT NULL,
  "scope_value" varchar(100) NOT NULL,
  "params" jsonb NOT NULL,
  "version" integer NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "note" text,
  "review_note" text,
  "simulated_at" timestamptz,
  "created_by" uuid REFERENCES "users"("id"),
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamptz,
  "activated_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rule_param_sets_module_scope_idx"
  ON "rule_param_sets" ("module_code", "scope_type", "scope_value");

CREATE UNIQUE INDEX IF NOT EXISTS "rule_param_sets_one_active_idx"
  ON "rule_param_sets" ("module_code", "scope_type", "scope_value")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS "rule_param_sets_version_idx"
  ON "rule_param_sets" ("module_code", "scope_type", "scope_value", "version");

CREATE TABLE IF NOT EXISTS "rule_eval_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module_code" varchar(50) NOT NULL,
  "trigger" varchar(20) NOT NULL,
  "module_version" integer NOT NULL,
  "param_set_ids" jsonb NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz
);
