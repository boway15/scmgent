import { count, eq, sql } from 'drizzle-orm';
import { db, skuStationWarehouseRefs } from '@scm/db';
import {
  buildSkuStationWarehouseRefs,
  decodeCsvBytes,
  type SkuStationWarehouseRefRow,
  type SkuStationWarehouseCsvStats,
} from './sku-station-warehouse-ref.js';

export type ImportSkuWarehouseRefResult = SkuStationWarehouseCsvStats & {
  upsertedUnique: number;
  upsertedDominant: number;
  upserted: number;
};

async function upsertRefChunk(rows: SkuStationWarehouseRefRow[], now: Date): Promise<void> {
  if (!rows.length) return;
  await db
    .insert(skuStationWarehouseRefs)
    .values(
      rows.map((row) => ({
        skuCode: row.skuCode,
        station: row.station,
        channel: row.channel,
        warehouseCode: row.warehouseCode,
        resolution: row.resolution,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [
        skuStationWarehouseRefs.skuCode,
        skuStationWarehouseRefs.station,
        skuStationWarehouseRefs.channel,
        skuStationWarehouseRefs.resolution,
      ],
      set: { warehouseCode: sql`excluded.warehouse_code`, updatedAt: now },
    });
}

export async function importSkuStationWarehouseRefsFromCsv(
  csvTextOrBytes: string | Buffer | Uint8Array,
): Promise<ImportSkuWarehouseRefResult> {
  const csvText = decodeCsvBytes(csvTextOrBytes);
  const parsed = buildSkuStationWarehouseRefs(csvText);
  const now = new Date();
  const CHUNK = 500;

  let upsertedUnique = 0;
  for (let offset = 0; offset < parsed.uniqueRefs.length; offset += CHUNK) {
    const chunk = parsed.uniqueRefs.slice(offset, offset + CHUNK);
    await upsertRefChunk(chunk, now);
    upsertedUnique += chunk.length;
  }

  let upsertedDominant = 0;
  for (let offset = 0; offset < parsed.dominantRefs.length; offset += CHUNK) {
    const chunk = parsed.dominantRefs.slice(offset, offset + CHUNK);
    await upsertRefChunk(chunk, now);
    upsertedDominant += chunk.length;
  }

  return {
    ...parsed,
    upsertedUnique,
    upsertedDominant,
    upserted: upsertedUnique + upsertedDominant,
  };
}

export type SalesHistoryWarehouseBackfillResult = {
  updated: number;
  refRows: number;
  resolution: 'unique' | 'dominant' | 'sales_region';
};

async function countRefs(resolution: 'unique' | 'dominant'): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(skuStationWarehouseRefs)
    .where(eq(skuStationWarehouseRefs.resolution, resolution));
  return Number(row?.n ?? 0);
}

async function backfillFromRefs(resolution: 'unique' | 'dominant'): Promise<SalesHistoryWarehouseBackfillResult> {
  const refRows = await countRefs(resolution);

  const result = await db.execute(sql`
    UPDATE sales_history AS sh
    SET
      warehouse_code = r.warehouse_code,
      sales_region = COALESCE(
        NULLIF(btrim(sh.sales_region), ''),
        wh.fulfillment_region,
        st.sales_region
      )
    FROM sku_station_warehouse_refs AS r
    INNER JOIN skus AS s ON s.code = r.sku_code
    LEFT JOIN warehouse_fulfillment_region_maps AS wh ON wh.warehouse_code = r.warehouse_code
    LEFT JOIN station_sales_region_maps AS st ON st.station = r.station
    WHERE sh.sku_id = s.id
      AND r.resolution = ${resolution}
      AND (sh.warehouse_code IS NULL OR btrim(sh.warehouse_code) = '')
      AND btrim(sh.station) = r.station
      AND sh.channel = r.channel
  `);

  return {
    updated: Number(result.rowCount ?? 0),
    refRows,
    resolution,
  };
}

export async function backfillSalesHistoryWarehouseFromUniqueRefs(): Promise<SalesHistoryWarehouseBackfillResult> {
  return backfillFromRefs('unique');
}

export async function backfillSalesHistoryWarehouseFromDominantRefs(): Promise<SalesHistoryWarehouseBackfillResult> {
  return backfillFromRefs('dominant');
}

/**
 * 策略 C：站点映射 → 销售区域，与同区域其它站点的 SKU 仓参考对齐（适用于 channel=UNKNOWN 或站点名与 CSV 不一致）。
 */
export async function backfillSalesHistoryWarehouseFromSalesRegionRefs(): Promise<SalesHistoryWarehouseBackfillResult> {
  const refRows = (await countRefs('unique')) + (await countRefs('dominant'));

  const result = await db.execute(sql`
    UPDATE sales_history AS sh
    SET
      warehouse_code = pick.wh,
      sales_region = COALESCE(
        NULLIF(btrim(sh.sales_region), ''),
        wh.fulfillment_region,
        sm_sh.sales_region
      )
    FROM skus AS s,
         station_sales_region_maps AS sm_sh,
         LATERAL (
           SELECT r.warehouse_code AS wh
           FROM sku_station_warehouse_refs AS r
           INNER JOIN station_sales_region_maps AS sm_r ON sm_r.station = r.station
           WHERE r.sku_code = s.code
             AND sm_r.sales_region = sm_sh.sales_region
           GROUP BY r.warehouse_code
           ORDER BY COUNT(*)::bigint DESC, r.warehouse_code
           LIMIT 1
         ) AS pick
    LEFT JOIN warehouse_fulfillment_region_maps AS wh ON wh.warehouse_code = pick.wh
    WHERE sh.sku_id = s.id
      AND sm_sh.station = btrim(sh.station)
      AND pick.wh IS NOT NULL
      AND (sh.warehouse_code IS NULL OR btrim(sh.warehouse_code) = '')
  `);

  return {
    updated: Number(result.rowCount ?? 0),
    refRows,
    resolution: 'sales_region',
  };
}

export async function getSkuWarehouseRefStats(): Promise<{
  refCount: number;
  uniqueCount: number;
  dominantCount: number;
}> {
  const [uniqueCount, dominantCount] = await Promise.all([
    countRefs('unique'),
    countRefs('dominant'),
  ]);
  return { refCount: uniqueCount + dominantCount, uniqueCount, dominantCount };
}
