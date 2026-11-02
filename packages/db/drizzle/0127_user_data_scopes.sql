CREATE TABLE IF NOT EXISTS "user_data_scopes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "dimension" varchar(50) NOT NULL,
  "value" varchar(200) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_data_scopes"
    ADD CONSTRAINT "user_data_scopes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_data_scopes_user_dim_value_idx"
  ON "user_data_scopes" ("user_id", "dimension", "value");
