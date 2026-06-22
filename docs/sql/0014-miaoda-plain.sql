-- 妙搭 SQL 控制台专用：0014_p0_ops（无 DO $$ 块、无 public. 前缀）
-- 用法：逐段粘贴执行；若类型已存在可跳过对应 CREATE TYPE

CREATE TYPE import_batch_status AS ENUM ('pending', 'success', 'partial', 'failed');
CREATE TYPE task_run_status AS ENUM ('running', 'success', 'failed');

ALTER TYPE data_source ADD VALUE IF NOT EXISTS 'pmc_receipt';

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  type varchar(50) NOT NULL,
  file_name varchar(255),
  row_count integer DEFAULT 0 NOT NULL,
  success_count integer DEFAULT 0 NOT NULL,
  error_count integer DEFAULT 0 NOT NULL,
  status import_batch_status DEFAULT 'pending' NOT NULL,
  error_summary text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS import_batches_type_created_idx ON import_batches (type, created_at);

CREATE TABLE IF NOT EXISTS task_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  task_name varchar(100) NOT NULL,
  status task_run_status DEFAULT 'running' NOT NULL,
  started_at timestamptz DEFAULT now() NOT NULL,
  finished_at timestamptz,
  result_summary text,
  error_message text,
  triggered_by varchar(200)
);

CREATE INDEX IF NOT EXISTS task_runs_task_started_idx ON task_runs (task_name, started_at);

CREATE TABLE IF NOT EXISTS pmc_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  plan_id uuid NOT NULL REFERENCES pmc_plans(id) ON DELETE cascade,
  plan_item_id uuid NOT NULL REFERENCES pmc_plan_items(id) ON DELETE cascade,
  sku_id uuid NOT NULL REFERENCES skus(id),
  warehouse_code varchar(100) NOT NULL,
  qty_received integer NOT NULL,
  received_date date NOT NULL,
  inventory_record_id uuid REFERENCES inventory_records(id),
  idempotency_key varchar(100),
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS pmc_receipts_plan_item_idx ON pmc_receipts (plan_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS pmc_receipts_idempotency_key_idx ON pmc_receipts (idempotency_key);

ALTER TABLE inventory_records ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE sales_history ADD COLUMN IF NOT EXISTS import_batch_id uuid;
