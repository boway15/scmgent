CREATE TABLE IF NOT EXISTS "qc_reinspection_factories" (
  "factory_name" varchar(200) PRIMARY KEY NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "qc_reinspection_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_record_id" varchar(100) NOT NULL,
  "bitable_record_id" varchar(100),
  "supplier_short_name" varchar(100),
  "inspection_status" varchar(50),
  "purchase_order_no" varchar(100),
  "demand_no" varchar(100),
  "sku" varchar(100),
  "product_name" text,
  "carton_count" varchar(50),
  "piece_count" varchar(50),
  "dest_warehouse" varchar(200),
  "factory_type" varchar(50),
  "expected_ship_date" varchar(40),
  "container_carton_count" varchar(50),
  "container_piece_count" varchar(50),
  "transfer_status" varchar(50),
  "follow_up_ready_at" varchar(40),
  "goods_ready_at" varchar(40),
  "loading_note" text,
  "gap_days" integer,
  "inserted_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "qc_reinspection_rows_source_record_id_idx"
  ON "qc_reinspection_rows" ("source_record_id");

CREATE INDEX IF NOT EXISTS "qc_reinspection_rows_inserted_at_idx"
  ON "qc_reinspection_rows" ("inserted_at");
