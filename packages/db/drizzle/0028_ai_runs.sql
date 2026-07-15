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
