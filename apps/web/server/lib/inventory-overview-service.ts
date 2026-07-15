import { sql } from 'drizzle-orm';
import { db } from '@scm/db';
import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants.js';
import { normalizeReplenishLight, type ReplenishLight } from './replenish-light.js';
import {
  INVENTORY_OVERVIEW_COLUMNS,
  readSkuPackagingFromEncodingMeta,
  readTurnoverSnapshot,
  readTurnoverSnapshotAt,
  type OverviewColumnDef,
} from './inventory-turnover-snapshot.js';
import {
  getDefaultVisibleColumnIds,
  projectTurnoverExtras,
  resolveOverviewColumnIds,
} from './inventory-overview-views.js';
import type { WarehouseStockLine } from './turnover-bucket-warehouse.js';

export type InventoryOverviewQuery = {
  page: number;
  pageSize: number;
  offset: number;
  q?: string;
  category?: string;
  lifecycle?: string;
  salesCountry?: string;
  merchantCode?: string;
  ownerName?: string;
  developerName?: string;
  view?: string;
  columns?: string[];
};

export type InventoryTurnoverOverviewItem = {
  skuId: string;
  updatedAt: string | null;
  inventoryRecordedDate: string | null;
  turnoverSnapshotAt: string | null;
  dataSource: string | null;
  category: string | null;
  code: string;
  lifecycle: string | null;
  name: string;
  salesCountry: string | null;
  productCategory: string | null;
  merchantCode: string | null;
  ownerName: string | null;
  developerName: string | null;
  merchantName: string | null;
  leadTimeDays: number | null;
  unitCost: string | null;
  unit: string;
  qtyInProduction: number;
  qtyPreOrder: number;
  salesQty3d: number;
  salesQty7d: number;
  salesQty14d: number;
  salesQty30d: number;
  replenishLight: ReplenishLight;
  packDimensionsCm: string | null;
  volumeM3: string | null;
  grossWeightKg: string | null;
  turnoverExtras: Record<string, string>;
  warehouseStocks: WarehouseStockLine[];
};

type SkuRow = {
  skuId: string;
  category: string | null;
  code: string;
  lifecycle: string | null;
  name: string;
  salesCountry: string | null;
  productCategory: string | null;
  merchantCode: string | null;
  ownerName: string | null;
  developerName: string | null;
  merchantName: string | null;
  leadTimeDays: number | null;
  unitCost: string | null;
  unit: string;
  replenishLight: string | null;
  skuUpdatedAt: string | Date | null;
  inventoryUpdatedAt: string | Date | null;
  inventoryRecordedDate: string | null;
  dataSource: string | null;
  encodingMeta: unknown;
  qtyInProduction: number;
  qtyPreOrder: number;
};

type WarehouseStockRow = {
  skuId: string;
  warehouseCode: string;
  qtyAvailable: number;
  qtyInTransit: number;
};

type SalesVelocityRow = {
  skuId: string;
  salesQty3d: number;
  salesQty7d: number;
  salesQty14d: number;
  salesQty30d: number;
};

function ilikePattern(raw: string): string {
  return `%${raw.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
}

function buildSkuFilters(query: InventoryOverviewQuery) {
  const parts: ReturnType<typeof sql>[] = [];

  if (query.q?.trim()) {
    const pattern = ilikePattern(query.q);
    parts.push(sql`(s.code ILIKE ${pattern} OR s.name ILIKE ${pattern})`);
  }
  if (query.category?.trim()) {
    parts.push(sql`s.category ILIKE ${ilikePattern(query.category)}`);
  }
  if (query.lifecycle?.trim()) {
    parts.push(sql`s.lifecycle ILIKE ${ilikePattern(query.lifecycle)}`);
  }
  if (query.salesCountry?.trim()) {
    parts.push(sql`s.sales_country ILIKE ${ilikePattern(query.salesCountry)}`);
  }
  if (query.merchantCode?.trim()) {
    parts.push(sql`s.merchant_code ILIKE ${ilikePattern(query.merchantCode)}`);
  }
  if (query.ownerName?.trim()) {
    parts.push(sql`s.owner_name ILIKE ${ilikePattern(query.ownerName)}`);
  }
  if (query.developerName?.trim()) {
    parts.push(sql`s.developer_name ILIKE ${ilikePattern(query.developerName)}`);
  }

  if (!parts.length) return sql``;
  return sql`AND ${sql.join(parts, sql` AND `)}`;
}

function pickLatestIso(...values: Array<string | Date | null | undefined>): string | null {
  let latest = 0;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}

const OVERVIEW_SKU_CTE = sql`
  WITH latest_inv AS (
    SELECT DISTINCT ON (sku_id, warehouse)
      sku_id,
      warehouse,
      qty_available,
      qty_in_transit,
      qty_in_production,
      qty_reserved
    FROM inventory_records
    ORDER BY sku_id, warehouse, recorded_date DESC, created_at DESC
  ),
  sku_with_inv AS (
    SELECT DISTINCT sku_id AS "skuId" FROM inventory_records
  ),
  sku_in_production AS (
    SELECT
      sku_id AS "skuId",
      COALESCE(MAX(CASE WHEN warehouse = ${IN_PRODUCTION_WAREHOUSE} THEN qty_in_production ELSE 0 END), 0)::int AS "qtyInProduction",
      COALESCE(MAX(CASE WHEN warehouse = ${IN_PRODUCTION_WAREHOUSE} THEN COALESCE(qty_reserved, 0) ELSE 0 END), 0)::int AS "qtyPreOrder"
    FROM latest_inv
    GROUP BY sku_id
  ),
  sku_timing AS (
    SELECT
      sku_id AS "skuId",
      MAX(created_at) AS "inventoryUpdatedAt",
      MAX(recorded_date)::text AS "inventoryRecordedDate"
    FROM inventory_records
    GROUP BY sku_id
  ),
  sku_latest_source AS (
    SELECT DISTINCT ON (sku_id)
      sku_id AS "skuId",
      source::text AS "dataSource"
    FROM inventory_records
    ORDER BY sku_id, created_at DESC
  )
`;

async function loadWarehouseStocksBySkuIds(skuIds: string[]): Promise<Map<string, WarehouseStockLine[]>> {
  if (!skuIds.length) return new Map();

  const result = await db.execute(sql`
    WITH latest_inv AS (
      SELECT DISTINCT ON (sku_id, warehouse)
        sku_id,
        warehouse,
        qty_available,
        qty_in_transit
      FROM inventory_records
      ORDER BY sku_id, warehouse, recorded_date DESC, created_at DESC
    )
    SELECT
      sku_id AS "skuId",
      warehouse AS "warehouseCode",
      qty_available::int AS "qtyAvailable",
      qty_in_transit::int AS "qtyInTransit"
    FROM latest_inv
    WHERE sku_id IN (${sql.join(
      skuIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND warehouse <> ${IN_PRODUCTION_WAREHOUSE}
    ORDER BY warehouse ASC
  `);

  const map = new Map<string, WarehouseStockLine[]>();
  for (const row of Array.from(result as unknown as WarehouseStockRow[])) {
    const list = map.get(row.skuId) ?? [];
    list.push({
      warehouseCode: row.warehouseCode,
      qtyAvailable: row.qtyAvailable,
      qtyInTransit: row.qtyInTransit,
    });
    map.set(row.skuId, list);
  }
  return map;
}

async function loadSalesVelocityBySkuIds(skuIds: string[]): Promise<Map<string, SalesVelocityRow>> {
  if (!skuIds.length) return new Map();

  const result = await db.execute(sql`
    SELECT
      sku_id AS "skuId",
      COALESCE(SUM(CASE WHEN sale_date >= CURRENT_DATE - INTERVAL '2 days' THEN qty_sold ELSE 0 END), 0)::int AS "salesQty3d",
      COALESCE(SUM(CASE WHEN sale_date >= CURRENT_DATE - INTERVAL '6 days' THEN qty_sold ELSE 0 END), 0)::int AS "salesQty7d",
      COALESCE(SUM(CASE WHEN sale_date >= CURRENT_DATE - INTERVAL '13 days' THEN qty_sold ELSE 0 END), 0)::int AS "salesQty14d",
      COALESCE(SUM(CASE WHEN sale_date >= CURRENT_DATE - INTERVAL '29 days' THEN qty_sold ELSE 0 END), 0)::int AS "salesQty30d"
    FROM sales_history
    WHERE sku_id IN (${sql.join(
      skuIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND sale_date >= CURRENT_DATE - INTERVAL '29 days'
    GROUP BY sku_id
  `);

  const map = new Map<string, SalesVelocityRow>();
  for (const row of Array.from(result as unknown as SalesVelocityRow[])) {
    map.set(row.skuId, row);
  }
  return map;
}

function mapSkuRowToItem(
  row: SkuRow,
  sales: SalesVelocityRow | undefined,
  stocks: WarehouseStockLine[],
  columnProjection?: string[],
): InventoryTurnoverOverviewItem {
  const fullSnapshot = readTurnoverSnapshot(row.encodingMeta);
  const turnoverSnapshotAt = readTurnoverSnapshotAt(row.encodingMeta);
  const turnoverExtras = projectTurnoverExtras(fullSnapshot, columnProjection);
  const packaging = readSkuPackagingFromEncodingMeta(row.encodingMeta);

  return {
    skuId: row.skuId,
    updatedAt: pickLatestIso(row.inventoryUpdatedAt, row.skuUpdatedAt, turnoverSnapshotAt),
    inventoryRecordedDate: row.inventoryRecordedDate,
    turnoverSnapshotAt,
    dataSource: row.dataSource,
    category: row.category,
    code: row.code,
    lifecycle: row.lifecycle,
    name: row.name,
    salesCountry: row.salesCountry,
    productCategory: row.productCategory,
    merchantCode: row.merchantCode,
    ownerName: row.ownerName,
    developerName: row.developerName,
    merchantName: row.merchantName,
    leadTimeDays: row.leadTimeDays,
    unitCost: row.unitCost,
    unit: row.unit,
    qtyInProduction: row.qtyInProduction,
    qtyPreOrder: row.qtyPreOrder,
    salesQty3d: sales?.salesQty3d ?? 0,
    salesQty7d: sales?.salesQty7d ?? 0,
    salesQty14d: sales?.salesQty14d ?? 0,
    salesQty30d: sales?.salesQty30d ?? 0,
    replenishLight: normalizeReplenishLight(row.replenishLight),
    packDimensionsCm: packaging.packDimensionsCm,
    volumeM3: packaging.volumeM3,
    grossWeightKg: packaging.grossWeightKg,
    turnoverExtras,
    warehouseStocks: stocks,
  };
}

async function fetchSkuRows(
  query: InventoryOverviewQuery,
  options?: { limit?: number; offset?: number; skuId?: string },
): Promise<SkuRow[]> {
  const filters = buildSkuFilters(query);
  const limit = options?.limit ?? query.pageSize;
  const offset = options?.offset ?? query.offset;
  const skuFilter = options?.skuId ? sql`AND s.id = ${options.skuId}::uuid` : sql``;

  const rowsResult = await db.execute(sql`
    ${OVERVIEW_SKU_CTE}
    SELECT
      s.id AS "skuId",
      s.category,
      s.code,
      s.lifecycle,
      s.name,
      s.sales_country AS "salesCountry",
      s.product_category AS "productCategory",
      s.merchant_code AS "merchantCode",
      s.owner_name AS "ownerName",
      s.developer_name AS "developerName",
      s.merchant_name AS "merchantName",
      s.lead_time_days AS "leadTimeDays",
      s.unit_cost::text AS "unitCost",
      s.unit,
      s.replenish_light AS "replenishLight",
      s.updated_at AS "skuUpdatedAt",
      st."inventoryUpdatedAt",
      st."inventoryRecordedDate",
      sls."dataSource",
      s.encoding_meta AS "encodingMeta",
      COALESCE(sip."qtyInProduction", 0) AS "qtyInProduction",
      COALESCE(sip."qtyPreOrder", 0) AS "qtyPreOrder"
    FROM skus s
    INNER JOIN sku_with_inv sw ON sw."skuId" = s.id
    LEFT JOIN sku_in_production sip ON sip."skuId" = s.id
    LEFT JOIN sku_timing st ON st."skuId" = s.id
    LEFT JOIN sku_latest_source sls ON sls."skuId" = s.id
    WHERE s.is_active = true
    ${filters}
    ${skuFilter}
    ORDER BY s.code ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  return Array.from(rowsResult as unknown as SkuRow[]);
}

export async function countInventoryOverviewRows(query: InventoryOverviewQuery): Promise<number> {
  const filters = buildSkuFilters(query);
  const countResult = await db.execute(sql`
    ${OVERVIEW_SKU_CTE}
    SELECT count(*)::int AS count
    FROM skus s
    INNER JOIN sku_with_inv sw ON sw."skuId" = s.id
    WHERE s.is_active = true
    ${filters}
  `);
  return Number((countResult as unknown as Array<{ count: number }>)[0]?.count ?? 0);
}

export function getInventoryOverviewColumnCatalog(): OverviewColumnDef[] {
  return INVENTORY_OVERVIEW_COLUMNS;
}

export async function buildInventoryOverviewRows(query: InventoryOverviewQuery) {
  const columnProjection = resolveOverviewColumnIds({
    view: query.view,
    columns: query.columns,
  });

  const [total, rows] = await Promise.all([
    countInventoryOverviewRows(query),
    fetchSkuRows(query),
  ]);

  const skuIds = rows.map((row) => row.skuId);
  const [salesBySku, stocksBySku] = await Promise.all([
    loadSalesVelocityBySkuIds(skuIds),
    loadWarehouseStocksBySkuIds(skuIds),
  ]);

  const items: InventoryTurnoverOverviewItem[] = rows.map((row) =>
    mapSkuRowToItem(
      row,
      salesBySku.get(row.skuId),
      stocksBySku.get(row.skuId) ?? [],
      columnProjection,
    ),
  );

  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    columns: getInventoryOverviewColumnCatalog(),
    defaultVisibleColumns: getDefaultVisibleColumnIds(),
  };
}

export async function buildInventoryOverviewItemBySkuId(
  skuId: string,
): Promise<InventoryTurnoverOverviewItem | null> {
  const rows = await fetchSkuRows(
    { page: 1, pageSize: 1, offset: 0 },
    { limit: 1, offset: 0, skuId },
  );
  const row = rows[0];
  if (!row) return null;

  const [salesBySku, stocksBySku] = await Promise.all([
    loadSalesVelocityBySkuIds([skuId]),
    loadWarehouseStocksBySkuIds([skuId]),
  ]);

  return mapSkuRowToItem(row, salesBySku.get(skuId), stocksBySku.get(skuId) ?? [], undefined);
}

export async function buildInventoryOverviewExportItems(
  query: Omit<InventoryOverviewQuery, 'page' | 'pageSize' | 'offset'>,
  options?: { fullColumns?: boolean },
): Promise<InventoryTurnoverOverviewItem[]> {
  const total = await countInventoryOverviewRows({
    ...query,
    page: 1,
    pageSize: 1,
    offset: 0,
  });
  const batchSize = 500;
  const items: InventoryTurnoverOverviewItem[] = [];
  const columnProjection = options?.fullColumns
    ? undefined
    : resolveOverviewColumnIds({ view: query.view, columns: query.columns });

  for (let offset = 0; offset < total; offset += batchSize) {
    const rows = await fetchSkuRows(
      { ...query, page: 1, pageSize: batchSize, offset },
      { limit: batchSize, offset },
    );
    const skuIds = rows.map((row) => row.skuId);
    const [salesBySku, stocksBySku] = await Promise.all([
      loadSalesVelocityBySkuIds(skuIds),
      loadWarehouseStocksBySkuIds(skuIds),
    ]);
    for (const row of rows) {
      items.push(
        mapSkuRowToItem(
          row,
          salesBySku.get(row.skuId),
          stocksBySku.get(row.skuId) ?? [],
          columnProjection,
        ),
      );
    }
  }

  return items;
}
