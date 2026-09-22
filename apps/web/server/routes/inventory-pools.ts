import { Hono } from 'hono';
import {
  countSupplyLots,
  listSupplyLots,
  syncInventorySupplyLots,
  updateLocalLotDates,
} from '../lib/inventory-supply-lot-sync.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { requireMenu } from '../lib/rbac.js';

export const inventoryPoolsRoutes = new Hono();

inventoryPoolsRoutes.get('/inventory/pools', requireMenu('inventory.pools', 'inventory.planning'), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const pool = c.req.query('pool') as 'overseas' | 'in_transit' | 'local' | undefined;
  const warehouseCode = c.req.query('warehouse')?.trim() || undefined;
  const skuId = c.req.query('skuId')?.trim() || undefined;
  const q = c.req.query('q')?.trim() || undefined;
  const filters = {
    pool: pool || undefined,
    warehouseCode,
    skuId,
    q,
  };
  const [items, total, dateUnknownCount] = await Promise.all([
    listSupplyLots({ ...filters, limit: pageSize, offset }),
    countSupplyLots(filters),
    countSupplyLots({ ...filters, dateUnknown: true }),
  ]);
  return c.json({ items, total, page, pageSize, dateUnknownCount });
});

inventoryPoolsRoutes.post(
  '/inventory/pools/sync',
  requireMenu('inventory.pools', 'inventory.planning'),
  async (c) => {
    const result = await syncInventorySupplyLots();
    return c.json(result);
  },
);

inventoryPoolsRoutes.patch(
  '/inventory/pools/:id',
  requireMenu('inventory.pools', 'inventory.planning'),
  async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{
      productionStatus?: 'in_production' | 'qc_pending' | 'completed';
      shipReadyAt?: string | null;
      latestShipDate?: string | null;
      remainingLogisticsDays?: number;
    }>();
    try {
      const updated = await updateLocalLotDates({
        lotId: id,
        productionStatus: body.productionStatus,
        shipReadyAt: body.shipReadyAt,
        latestShipDate: body.latestShipDate,
        remainingLogisticsDays: body.remainingLogisticsDays,
      });
      if (!updated) return c.json({ message: 'Lot not found' }, 404);
      return c.json(updated);
    } catch (err) {
      return c.json(
        { message: err instanceof Error ? err.message : 'update failed' },
        400,
      );
    }
  },
);
