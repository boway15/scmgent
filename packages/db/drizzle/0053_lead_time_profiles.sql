CREATE TYPE "public"."transport_mode" AS ENUM ('fcl','lcl','air','express','rail','truck_air','direct');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_time_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "merchant_code" varchar(100),
  "origin_location" varchar(100),
  "destination_warehouse_code" varchar(100) NOT NULL,
  "transport_mode" "public"."transport_mode",
  "production_days" integer DEFAULT 0 NOT NULL,
  "domestic_days" integer DEFAULT 0 NOT NULL,
  "booking_days" integer DEFAULT 0 NOT NULL,
  "transit_days" integer DEFAULT 0 NOT NULL,
  "customs_days" integer DEFAULT 0 NOT NULL,
  "inbound_days" integer DEFAULT 0 NOT NULL,
  "lead_time_std_dev" integer,
  "is_default" boolean DEFAULT false NOT NULL,
  "source_system" varchar(50),
  "external_id" varchar(100),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_time_profiles_merchant_wh_idx"
  ON "lead_time_profiles" ("merchant_code", "destination_warehouse_code");
