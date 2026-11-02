-- 二次验货按 采购单号 + SKU + 需求单号 + 调拨单号 只保留最早插入的一行。
DELETE FROM qc_reinspection_rows AS extra
USING qc_reinspection_rows AS keep
WHERE extra.id <> keep.id
  AND coalesce(extra.purchase_order_no, '') = coalesce(keep.purchase_order_no, '')
  AND coalesce(extra.sku, '') = coalesce(keep.sku, '')
  AND coalesce(extra.demand_no, '') = coalesce(keep.demand_no, '')
  AND coalesce(extra.transfer_order_no, '') = coalesce(keep.transfer_order_no, '')
  AND (
    extra.inserted_at > keep.inserted_at
    OR (extra.inserted_at = keep.inserted_at AND extra.id::text > keep.id::text)
  );

CREATE UNIQUE INDEX IF NOT EXISTS qc_reinspection_rows_business_key_idx
  ON qc_reinspection_rows (
    coalesce(purchase_order_no, ''),
    coalesce(sku, ''),
    coalesce(demand_no, ''),
    coalesce(transfer_order_no, '')
  );
