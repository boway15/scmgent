import { eq, desc, and, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, inventoryRecords, skus, safetyStockConfig, warehouses, channelWarehousePrefs, merchants, salesForecastMonthly } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import { buildCsv, csvAttachment } from '../lib/csv-export.js';
import { IN_PRODUCTION_WAREHOUSE } from '../lib/inventory-constants.js';
import { getLatestInProductionQty } from '../lib/inventory-snapshot.js';
import {
  applyReplenishLightToRows,
  normalizeReplenishLight,
  needsReplenishmentByInventory,
  type ReplenishLight,
} from '../lib/replenish-light.js';
import type { InventoryHealth } from '../lib/inventory-light.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { buildInventoryOverviewRows, buildInventoryOverviewItemBySkuId, buildInventoryOverviewExportItems } from '../lib/inventory-overview-service.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { getViewColumnIds, resolveOverviewColumnIds } from '../lib/inventory-overview-views.js';
import { getOverviewCellValue } from '../lib/inventory-overview-cell-value.js';
import { INVENTORY_OVERVIEW_COLUMN_BY_ID } from '../lib/inventory-turnover-snapshot.js';

export const inventoryRoutes = new Hono();

function parseOverviewFilters(c: { req: { query: (k: string) => string | undefined } }) {
  const columnsRaw = c.req.query('columns')?.trim();
  const columns = columnsRaw
    ? columnsRaw.split(',').map((s) => decodeURIComponent(s.trim())).filter(Boolean)
    : undefined;
  return {
    q: c.req.query('q')?.trim() || undefined,
    category: c.req.query('category')?.trim() || undefined,
    lifecycle: c.req.query('lifecycle')?.trim() || undefined,
    salesCountry: c.req.query('salesCountry')?.trim() || undefined,
    merchantCode: c.req.query('merchantCode')?.trim() || undefined,
    ownerName: c.req.query('ownerName')?.trim() || undefined,
    developerName: c.req.query('developerName')?.trim() || undefined,
    view: c.req.query('view')?.trim() || undefined,
    columns,
  };
}

inventoryRoutes.get('/inventory/overview/export', requireMenu('inventory.overview'), async (c) => {
  const filters = parseOverviewFilters(c);
  const full = c.req.query('full') === 'true';
  const columnIds =
    full
      ? getViewColumnIds('excel_full')
      : resolveOverviewColumnIds({ view: filters.view, columns: filters.columns }) ??
        getViewColumnIds('replenish');

  const items = await buildInventoryOverviewExportItems(filters, { fullColumns: full });
  const headers = columnIds.map((id) => INVENTORY_OVERVIEW_COLUMN_BY_ID.get(id)?.label ?? id);
  const rows = items.map((item) => columnIds.map((colId) => getOverviewCellValue(item, colId)));

  const csv = buildCsv(headers, rows);
  return csvAttachment(`inventory-turnover-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

inventoryRoutes.get('/inventory/overview/:skuId', requireMenu('inventory.overview'), async (c) => {
  const skuId = c.req.param('skuId');
  const item = await buildInventoryOverviewItemBySkuId(skuId);
  if (!item) return c.json({ message: 'SKU not found' }, 404);
  return c.json(item);
});

inventoryRoutes.get('/inventory/overview', requireMenu('inventory.overview'), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
    20,
  );

  const filters = parseOverviewFilters(c);

  return c.json(
    await buildInventoryOverviewRows({
      page,
      pageSize,
      offset,
      ...filters,
    }),
  );
});

inventoryRoutes.get('/inventory/export', async (c) => {
  const warehouseFilter = c.req.query('warehouse');
  const whList = warehouseFilter
    ? [{ code: warehouseFilter }]
    : await db
        .select({ code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.isActive, true))
        .orderBy(warehouses.sortOrder);

  const skuRows = await db
    .select({ id: skus.id, code: skus.code, name: skus.name, replenishLight: skus.replenishLight })
    .from(skus)
    .where(eq(skus.isActive, true))
    .orderBy(skus.code);

  const rows: Array<Array<string | number>> = [];
  for (const sku of skuRows) {
    const qtyInProduction = await getLatestInProductionQty(sku.id);

    for (const wh of whList) {
      const [record] = await db
        .select({
          qtyAvailable: inventoryRecords.qtyAvailable,
          qtyInTransit: inventoryRecords.qtyInTransit,
          qtyReserved: inventoryRecords.qtyReserved,
        })
        .from(inventoryRecords)
        .where(and(eq(inventoryRecords.skuId, sku.id), eq(inventoryRecords.warehouse, wh.code)))
        .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
        .limit(1);

      const [cfg] = await db
        .select({ reorderPoint: safetyStockConfig.reorderPoint })
        .from(safetyStockConfig)
        .where(
          and(eq(safetyStockConfig.skuId, sku.id), eq(safetyStockConfig.warehouseCode, wh.code)),
        )
        .limit(1);

      const qtyAvailable = record?.qtyAvailable ?? 0;
      const qtyInTransit = record?.qtyInTransit ?? 0;
      const qtyReserved = record?.qtyReserved ?? 0;
      const localEffectiveQty = qtyAvailable + qtyInTransit;

      rows.push([
        wh.code,
        sku.code,
        sku.name,
        normalizeReplenishLight(sku.replenishLight),
        qtyAvailable,
        qtyInTransit,
        qtyInProduction,
        qtyReserved,
        localEffectiveQty,
        cfg?.reorderPoint ?? '',
      ]);
    }
  }

  const csv = buildCsv(
    ['warehouse', 'sku_code', 'sku_name', 'replenish_light', 'qty_available', 'qty_in_transit', 'sku_qty_in_production', 'qty_reserved', 'local_effective_qty', 'reorder_point'],
    rows,
  );
  return csvAttachment(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

inventoryRoutes.get('/inventory/records', async (c) => {
  const skuId = c.req.query('skuId');

  const baseQuery = db
    .select({
      id: inventoryRecords.id,
      skuId: inventoryRecords.skuId,
      skuCode: skus.code,
      warehouse: inventoryRecords.warehouse,
      qtyAvailable: inventoryRecords.qtyAvailable,
      qtyInTransit: inventoryRecords.qtyInTransit,
      qtyInProduction: inventoryRecords.qtyInProduction,
      recordedDate: inventoryRecords.recordedDate,
      source: inventoryRecords.source,
    })
    .from(inventoryRecords)
    .innerJoin(skus, eq(skus.id, inventoryRecords.skuId))
    .$dynamic();

  const rows = skuId
    ? await baseQuery
        .where(eq(inventoryRecords.skuId, skuId))
        .orderBy(desc(inventoryRecords.recordedDate))
        .limit(100)
    : await baseQuery.orderBy(desc(inventoryRecords.recordedDate)).limit(100);

  return c.json(rows);
});

inventoryRoutes.post('/inventory/records', requireMenu('inventory.overview'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    skuId: string;
    warehouse: string;
    qtyAvailable?: number;
    qtyInTransit?: number;
    qtyInProduction?: number;
    recordedDate: string;
  }>();

  if (!body.skuId || !body.warehouse || !body.recordedDate) {
    return c.json({ message: 'skuId, warehouse, recordedDate required' }, 400);
  }

  const isProductionPool = body.warehouse === IN_PRODUCTION_WAREHOUSE;
  if (isProductionPool) {
    if (body.qtyInProduction == null) {
      return c.json({ message: 'qtyInProduction required for IN-PRODUCTION pool' }, 400);
    }
  } else if (body.qtyAvailable == null) {
    return c.json({ message: 'qtyAvailable required for physical warehouse' }, 400);
  }

  const [row] = await db
    .insert(inventoryRecords)
    .values({
      skuId: body.skuId,
      warehouse: body.warehouse,
      qtyAvailable: isProductionPool ? 0 : (body.qtyAvailable ?? 0),
      qtyInTransit: isProductionPool ? 0 : (body.qtyInTransit ?? 0),
      qtyInProduction: isProductionPool ? body.qtyInProduction! : 0,
      recordedDate: body.recordedDate,
      source: 'manual',
      createdBy: user.id,
    })
    .returning();

  await writeAuditLog(c, {
    action: 'inventory_record.create',
    resourceType: 'inventory_record',
    resourceId: row.id,
    detail: body,
    user,
  });

  return c.json(row, 201);
});

inventoryRoutes.get('/merchants', async (c) => {
  const masterRows = await db
    .select({
      merchantCode: merchants.code,
      merchantName: merchants.name,
    })
    .from(merchants)
    .where(eq(merchants.isActive, true))
    .orderBy(merchants.code);

  if (masterRows.length) {
    return c.json(masterRows);
  }

  const rows = await db
    .select({
      merchantCode: skus.merchantCode,
      merchantName: skus.merchantName,
    })
    .from(skus)
    .where(eq(skus.isActive, true));

  const map = new Map<string, string | null>();
  for (const row of rows) {
    if (!row.merchantCode) continue;
    if (!map.has(row.merchantCode)) {
      map.set(row.merchantCode, row.merchantName);
    }
  }

  return c.json(
    Array.from(map.entries())
      .map(([merchantCode, merchantName]) => ({ merchantCode, merchantName }))
      .sort((a, b) => a.merchantCode.localeCompare(b.merchantCode)),
  );
});

inventoryRoutes.get('/warehouses', async (c) => {
  const rows = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(warehouses.sortOrder);
  return c.json(rows);
});

inventoryRoutes.get('/channel-warehouse-prefs', async (c) => {
  const rows = await db
    .select()
    .from(channelWarehousePrefs)
    .where(eq(channelWarehousePrefs.isActive, true))
    .orderBy(channelWarehousePrefs.channel);
  return c.json(rows);
});
