import { sql } from 'drizzle-orm';
import { db } from '@scm/db';

export type SalesHistoryRegionBackfillResult = {
  updated: number;
};

/**
 * 历史销量：sales_region 为空且 station 有值时，按站点映射写入销售区域。
 */
export async function backfillSalesHistorySalesRegionFromStations(): Promise<SalesHistoryRegionBackfillResult> {
  const result = await db.execute(sql`
    UPDATE sales_history AS sh
    SET sales_region = m.sales_region
    FROM station_sales_region_maps AS m
    WHERE (sh.sales_region IS NULL OR btrim(sh.sales_region) = '')
      AND sh.station IS NOT NULL
      AND btrim(sh.station) <> ''
      AND m.station = btrim(sh.station)
  `);
  return { updated: Number(result.rowCount ?? 0) };
}

/**
 * 历史销量：sales_region 仍为空且 warehouse_code 有值时，按仓库履约映射写入销售区域（一期 1:1）。
 */
export async function backfillSalesHistorySalesRegionFromWarehouses(): Promise<SalesHistoryRegionBackfillResult> {
  const result = await db.execute(sql`
    UPDATE sales_history AS sh
    SET sales_region = m.fulfillment_region
    FROM warehouse_fulfillment_region_maps AS m
    WHERE (sh.sales_region IS NULL OR btrim(sh.sales_region) = '')
      AND sh.warehouse_code IS NOT NULL
      AND btrim(sh.warehouse_code) <> ''
      AND m.warehouse_code = btrim(sh.warehouse_code)
  `);
  return { updated: Number(result.rowCount ?? 0) };
}
