import { Hono } from 'hono';
import { getSkuPlanningView } from '../lib/inventory-planning-service.js';
import { requireMenu } from '../lib/rbac.js';

export const inventoryPlanningRoutes = new Hono();

inventoryPlanningRoutes.get(
  '/inventory/planning/:skuId',
  requireMenu('inventory.planning'),
  async (c) => {
    const skuId = c.req.param('skuId');
    if (!skuId) return c.json({ message: 'skuId required' }, 400);
    const item = await getSkuPlanningView({
      skuId,
      warehouseCode: c.req.query('warehouse')?.trim() || undefined,
    });
    if (!item) return c.json({ message: 'SKU or warehouse not found' }, 404);
    return c.json(item);
  },
);
