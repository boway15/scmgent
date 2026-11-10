import { eq, desc, and, inArray } from 'drizzle-orm';
import {
  resolveRequestProjectGroupScope,
  skuInProjectGroupScope,
  skuProjectGroupCondition,
} from '../lib/data-scope.js';
import { Hono } from 'hono';
import { db, inventoryRecords, skus, warehouses, channelWarehousePrefs, merchants, salesForecastMonthly } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { analysisOnlyResponse } from '../lib/analysis-only.js';
import { requireMenu } from '../lib/rbac.js';
import { enqueueDownloadJob } from '../lib/download-enqueue.js';
import { IN_PRODUCTION_WAREHOUSE } from '../lib/inventory-constants.js';
import {
  applyReplenishLightToRows,
  needsReplenishmentByInventory,
  type ReplenishLight,
} from '../lib/replenish-light.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { buildInventoryOverviewRows, buildInventoryOverviewItemBySkuId } from '../lib/inventory-overview-service.js';
import { parseListPagination } from '../lib/list-pagination.js';
import {
  DEFAULT_INVENTORY_TREND_FIELDS,
  listInventorySnapshotDates,
  loadInventoryTrend,
} from '../lib/inventory-daily-snapshot.js';
import {
  listProcurementOpsRows,
  listProcurementOpsSnapshotDates,
} from '../lib/procurement-ops-service.js';
import {
  listInventoryQueryRows,
  listInventoryQuerySnapshotDates,
} from '../lib/inventory-query-service.js';
import { parseProductScope } from '../lib/planning-accessory-filter.js';
import { parseHealthStatusesParam } from '../lib/sku-health-aggregate.js';

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
    snapshotDate: c.req.query('snapshotDate')?.trim() || undefined,
    productScope: parseProductScope(c.req.query('productScope')),
    columns,
    healthStatuses: parseHealthStatusesParam(c.req.query('healthStatuses')),
  };
}

function parseQueryFilters(c: { req: { query: (k: string) => string | undefined } }) {
  const columnsRaw = c.req.query('columns')?.trim();
  const columns = columnsRaw
    ? columnsRaw.split(',').map((s) => decodeURIComponent(s.trim())).filter(Boolean)
    : undefined;
  return {
    q: c.req.query('q')?.trim() || undefined,
    category: c.req.query('category')?.trim() || undefined,
    lifecycle: c.req.query('lifecycle')?.trim() || undefined,
    salesCountry: c.req.query('salesCountry')?.trim() || undefined,
    snapshotDate: c.req.query('snapshotDate')?.trim() || undefined,
    productScope: parseProductScope(c.req.query('productScope')),
    columns,
  };
}

inventoryRoutes.get('/inventory/query/export', requireMenu('inventory.overview'), async (c) => {
  const filters = parseQueryFilters(c);
  const projectGroupScope = await resolveRequestProjectGroupScope(c);
  const date = new Date().toISOString().slice(0, 10);
  return enqueueDownloadJob(c, {
    jobType: 'inventory_query',
    title: `库存查询导出-${date}`,
    fileName: `inventory-query-${date}-${filters.productScope}.csv`,
    params: { ...filters, projectGroupScope },
  });
});

inventoryRoutes.get('/inventory/query/dates', requireMenu('inventory.overview'), async (c) => {
  return c.json({ items: await listInventoryQuerySnapshotDates() });
});

inventoryRoutes.get('/inventory/query', requireMenu('inventory.overview'), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
    20,
  );
  const filters = parseQueryFilters(c);
  const projectGroupScope = await resolveRequestProjectGroupScope(c);
  return c.json(
    await listInventoryQueryRows({
      page,
      pageSize,
      offset,
      ...filters,
      projectGroupScope,
    }),
  );
});

inventoryRoutes.get(
  '/inventory/procurement-ops/export',
  requireMenu('inventory.overview'),
  async (c) => {
    const filters = parseQueryFilters(c);
    const projectGroupScope = await resolveRequestProjectGroupScope(c);
    const date = new Date().toISOString().slice(0, 10);
    return enqueueDownloadJob(c, {
      jobType: 'inventory_procurement_ops',
      title: `采购在途导出-${date}`,
      fileName: `procurement-ops-${date}-${filters.productScope}.csv`,
      params: { ...filters, projectGroupScope },
    });
  },
);

inventoryRoutes.get(
  '/inventory/procurement-ops/dates',
  requireMenu('inventory.overview'),
  async (c) => {
    return c.json({ items: await listProcurementOpsSnapshotDates() });
  },
);

inventoryRoutes.get(
  '/inventory/procurement-ops',
  requireMenu('inventory.overview'),
  async (c) => {
    const { page, pageSize, offset } = parseListPagination(
      c.req.query('page')?.trim(),
      c.req.query('pageSize')?.trim(),
      20,
    );
    const filters = parseQueryFilters(c);
    const projectGroupScope = await resolveRequestProjectGroupScope(c);
    return c.json(
      await listProcurementOpsRows({
        page,
        pageSize,
        offset,
        ...filters,
        projectGroupScope,
      }),
    );
  },
);

inventoryRoutes.get('/inventory/overview/export', requireMenu('inventory.overview'), async (c) => {
  const filters = parseOverviewFilters(c);
  const projectGroupScope = await resolveRequestProjectGroupScope(c);
  const full = c.req.query('full') === 'true';
  const date = new Date().toISOString().slice(0, 10);
  return enqueueDownloadJob(c, {
    jobType: 'inventory_overview',
    title: `库存周转导出-${date}`,
    fileName: `inventory-turnover-${date}-${filters.productScope}.csv`,
    params: { filters, projectGroupScope, full },
  });
});

inventoryRoutes.get('/inventory/overview/dates', requireMenu('inventory.overview'), async (c) => {
  return c.json({ items: await listInventorySnapshotDates() });
});

inventoryRoutes.get(
  '/inventory/overview/:skuId/trend',
  requireMenu('inventory.overview'),
  async (c) => {
    const skuId = c.req.param('skuId');
    if (!skuId) return c.json({ message: 'skuId required' }, 400);
    const requestedFields = c.req
      .query('fields')
      ?.split(',')
      .map((field) => decodeURIComponent(field.trim()))
      .filter(Boolean);
    const fields = requestedFields?.length
      ? requestedFields.slice(0, 12)
      : [...DEFAULT_INVENTORY_TREND_FIELDS];
    const scope = await resolveRequestProjectGroupScope(c);
    const [sku] = await db
      .select({ projectGroup: skus.projectGroup })
      .from(skus)
      .where(eq(skus.id, skuId))
      .limit(1);
    if (!sku || !skuInProjectGroupScope(sku.projectGroup, scope)) {
      return c.json({ message: 'SKU not found' }, 404);
    }
    return c.json({ fields, items: await loadInventoryTrend(skuId, fields) });
  },
);

inventoryRoutes.get('/inventory/overview/:skuId', requireMenu('inventory.overview'), async (c) => {
  const skuId = c.req.param('skuId');
  if (!skuId) return c.json({ message: 'skuId required' }, 400);
  const scope = await resolveRequestProjectGroupScope(c);
  const item = await buildInventoryOverviewItemBySkuId(
    skuId,
    c.req.query('snapshotDate')?.trim() || undefined,
    scope,
  );
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
  const projectGroupScope = await resolveRequestProjectGroupScope(c);

  return c.json(
    await buildInventoryOverviewRows({
      page,
      pageSize,
      offset,
      ...filters,
      projectGroupScope,
    }),
  );
});

inventoryRoutes.get('/inventory/export', requireMenu('inventory.overview'), async (c) => {
  const projectGroupScope = await resolveRequestProjectGroupScope(c);
  const warehouse = c.req.query('warehouse')?.trim() || undefined;
  const date = new Date().toISOString().slice(0, 10);
  return enqueueDownloadJob(c, {
    jobType: 'inventory_full',
    title: `库存全量导出-${date}`,
    fileName: `inventory-${date}.csv`,
    params: { projectGroupScope, warehouse },
  });
});

inventoryRoutes.get('/inventory/records', requireMenu('inventory.overview'), async (c) => {
  const skuId = c.req.query('skuId');
  const scope = await resolveRequestProjectGroupScope(c);
  const scopeCond = skuProjectGroupCondition(scope);

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

  const recordConditions = [
    ...(scopeCond ? [scopeCond] : []),
    ...(skuId ? [eq(inventoryRecords.skuId, skuId)] : []),
  ];
  const where = recordConditions.length ? and(...recordConditions) : undefined;

  const rows = await baseQuery
    .where(where)
    .orderBy(desc(inventoryRecords.recordedDate))
    .limit(100);

  return c.json(rows);
});

inventoryRoutes.post('/inventory/records', requireMenu('inventory.overview'), async (c) =>
  analysisOnlyResponse(c),
);

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
