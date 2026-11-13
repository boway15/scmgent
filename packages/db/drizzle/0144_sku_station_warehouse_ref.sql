CREATE TABLE IF NOT EXISTS "sku_station_warehouse_refs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sku_code" varchar(100) NOT NULL,
  "station" varchar(100) NOT NULL,
  "channel" varchar(100) NOT NULL,
  "warehouse_code" varchar(100) NOT NULL,
  "resolution" varchar(20) DEFAULT 'unique' NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sku_station_warehouse_refs_identity_uidx"
  ON "sku_station_warehouse_refs" ("sku_code", "station", "channel", "resolution");
