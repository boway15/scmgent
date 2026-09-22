import { eq, inArray, sql } from 'drizzle-orm';
import { db, inventoryRecords, inventorySupplyLots, skus } from '@scm/db';
import { detectInventoryDataIssues, type DataIssueLot, type DataIssueSku } from '../lib/inventory-data-issues.js';
import { applyDataIssueUpsert } from '../lib/inventory-data-issue-store.js';
import { buildAllocationBySku } from '../lib/inventory-supply-lot-sync.js';

function asIsoDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export async function runInventoryDataIssueScan() {
  const lotRows = await db
    .select({
      skuId: inventorySupplyLots.skuId,
      warehouseCode: inventorySupplyLots.warehouseCode,
      pool: inventorySupplyLots.pool,
      qty: inventorySupplyLots.qty,
      status: inventorySupplyLots.status,
      dateUnknown: inventorySupplyLots.dateUnknown,
      availableAt: inventorySupplyLots.availableAt,
      source: inventorySupplyLots.source,
      sourceId: inventorySupplyLots.sourceId,
    })
    .from(inventorySupplyLots)
    .where(eq(inventorySupplyLots.status, 'open'));

  const lots: DataIssueLot[] = lotRows.map((row) => ({
    skuId: row.skuId,
    warehouseCode: row.warehouseCode,
    pool: row.pool,
    qty: row.qty,
    status: row.status,
    dateUnknown: row.dateUnknown,
    availableAt: asIsoDate(row.availableAt),
    source: row.source,
    sourceId: row.sourceId,
  }));

  const overseasRows = await db.execute(sql`
    SELECT DISTINCT ON (sku_id)
      sku_id AS "skuId",
      qty_available::int AS "qtyAvailable"
    FROM ${inventoryRecords}
    WHERE warehouse = 'OVERSEAS'
    ORDER BY sku_id, recorded_date DESC, created_at DESC
  `);
  const overseas = Array.from(
    overseasRows as unknown as Array<{ skuId: string; qtyAvailable: number }>,
  );

  const skuIds = [...new Set([...lots.map((row) => row.skuId), ...overseas.map((row) => row.skuId)])];
  const skuRows =
    skuIds.length === 0
      ? []
      : await db
          .select({
            skuId: skus.id,
            skuCode: skus.code,
            encodingMeta: skus.encodingMeta,
          })
          .from(skus)
          .where(inArray(skus.id, skuIds));

  const allocationBySku = buildAllocationBySku(skuRows);
  const skuById = new Map(skuRows.map((row) => [row.skuId, row]));
  const detectSkus: DataIssueSku[] = overseas.map((row) => {
    const sku = skuById.get(row.skuId);
    const share = allocationBySku.get(row.skuId)?.share ?? {
      method: 'unallocated' as const,
      shareSum: 0,
      shareSumWarning: false,
      weights: [],
    };
    return {
      skuId: row.skuId,
      skuCode: sku?.skuCode ?? '',
      overseasAvailable: row.qtyAvailable,
      share,
    };
  });

  const detected = detectInventoryDataIssues({ lots, skus: detectSkus });
  const upsert = await applyDataIssueUpsert(detected);
  return {
    scannedLots: lots.length,
    scannedSkus: detectSkus.length,
    detected: detected.length,
    ...upsert,
  };
}
