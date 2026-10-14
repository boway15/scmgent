import { Hono } from 'hono';
import { csvAttachment } from '../lib/csv-export.js';
import {
  buildSupplyLotSummaryExportCsv,
  countSupplyLotSummaries,
  listSupplyLotSummaries,
  listSupplyLotWarehouseOptions,
  parseSupplyLotSummaryFilters,
} from '../lib/inventory-supply-lot-summary.js';
import {
  buildSupplyLotsExportCsv,
  countSupplyLots,
  listSupplyLots,
  parseSupplyLotExportFilters,
  syncInventorySupplyLots,
} from '../lib/inventory-supply-lot-sync.js';
import { analysisOnlyResponse } from '../lib/analysis-only.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { requireMenu } from '../lib/rbac.js';

export const inventoryPoolsRoutes = new Hono();

function todayFilenameSuffix() {
  return new Date().toISOString().slice(0, 10);
}

inventoryPoolsRoutes.get(
  '/inventory/pools/warehouses',
  requireMenu('inventory.pools', 'inventory.planning_dashboard'),
  async (c) => {
    const items = await listSupplyLotWarehouseOptions();
    return c.json({ items });
  },
);

inventoryPoolsRoutes.get(
  '/inventory/pools/summary/export',
  requireMenu('inventory.pools', 'inventory.planning_dashboard'),
  async (c) => {
    const filters = parseSupplyLotSummaryFilters({
      q: c.req.query('q'),
      warehouse: c.req.query('warehouse'),
      hasOverseas: c.req.query('hasOverseas'),
      hasInTransit: c.req.query('hasInTransit'),
      hasLocal: c.req.query('hasLocal'),
      hasUndatedTransit: c.req.query('hasUndatedTransit'),
      multiTransitBatch: c.req.query('multiTransitBatch'),
      productScope: c.req.query('productScope'),
    });
    const csv = await buildSupplyLotSummaryExportCsv(filters);
    return csvAttachment(
      `inventory-pools-summary-${todayFilenameSuffix()}-${filters.productScope}.csv`,
      csv,
    );
  },
);

inventoryPoolsRoutes.get(
  '/inventory/pools/export',
  requireMenu('inventory.pools', 'inventory.planning_dashboard'),
  async (c) => {
    const filters = parseSupplyLotExportFilters({
      pool: c.req.query('pool'),
      warehouse: c.req.query('warehouse'),
      q: c.req.query('q'),
      dateUnknown: c.req.query('dateUnknown'),
      productScope: c.req.query('productScope'),
    });
    const csv = await buildSupplyLotsExportCsv(filters);
    const poolSuffix = filters.pool ?? 'all';
    return csvAttachment(
      `inventory-pools-batches-${poolSuffix}-${todayFilenameSuffix()}-${filters.productScope}.csv`,
      csv,
    );
  },
);

inventoryPoolsRoutes.get(
  '/inventory/pools/summary',
  requireMenu('inventory.pools', 'inventory.planning_dashboard'),
  async (c) => {
    const { page, pageSize, offset } = parseListPagination(
      c.req.query('page')?.trim(),
      c.req.query('pageSize')?.trim(),
    );
    const filters = parseSupplyLotSummaryFilters({
      q: c.req.query('q'),
      warehouse: c.req.query('warehouse'),
      hasOverseas: c.req.query('hasOverseas'),
      hasInTransit: c.req.query('hasInTransit'),
      hasLocal: c.req.query('hasLocal'),
      hasUndatedTransit: c.req.query('hasUndatedTransit'),
      multiTransitBatch: c.req.query('multiTransitBatch'),
      productScope: c.req.query('productScope'),
    });
    const [items, total] = await Promise.all([
      listSupplyLotSummaries({ ...filters, limit: pageSize, offset }),
      countSupplyLotSummaries(filters),
    ]);
    return c.json({ items, total, page, pageSize });
  },
);

inventoryPoolsRoutes.get('/inventory/pools', requireMenu('inventory.pools', 'inventory.planning_dashboard'), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const pool = c.req.query('pool') as 'overseas' | 'in_transit' | 'local' | undefined;
  const warehouseCode = c.req.query('warehouse')?.trim() || undefined;
  const skuId = c.req.query('skuId')?.trim() || undefined;
  const q = c.req.query('q')?.trim() || undefined;
  const dateUnknown = c.req.query('dateUnknown') === 'true' ? true : undefined;
  const filters = parseSupplyLotExportFilters({
    pool: c.req.query('pool'),
    warehouse: c.req.query('warehouse'),
    q: c.req.query('q'),
    dateUnknown: c.req.query('dateUnknown'),
    productScope: c.req.query('productScope'),
  });
  const lotFilters = {
    pool: filters.pool,
    warehouseCode: warehouseCode ?? filters.warehouseCode,
    skuId,
    q: filters.q,
    dateUnknown: filters.dateUnknown,
    productScope: filters.productScope,
  };
  const [items, total, dateUnknownCount] = await Promise.all([
    listSupplyLots({ ...lotFilters, limit: pageSize, offset }),
    countSupplyLots(lotFilters),
    countSupplyLots({ ...lotFilters, dateUnknown: true }),
  ]);
  return c.json({ items, total, page, pageSize, dateUnknownCount });
});

inventoryPoolsRoutes.post(
  '/inventory/pools/sync',
  requireMenu('inventory.pools', 'inventory.planning_dashboard'),
  async (c) => {
    const result = await syncInventorySupplyLots();
    return c.json(result);
  },
);

inventoryPoolsRoutes.patch(
  '/inventory/pools/:id',
  requireMenu('inventory.pools', 'inventory.planning_dashboard'),
  async (c) => analysisOnlyResponse(c),
);
