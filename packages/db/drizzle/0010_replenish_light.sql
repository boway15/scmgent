DO $$ BEGIN
 CREATE TYPE "public"."replenish_light" AS ENUM('red', 'yellow', 'green');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "replenish_light" "replenish_light" DEFAULT 'red' NOT NULL;
