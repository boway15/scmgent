import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import { writeAuditLog } from '../lib/audit-log.js';
import {
  assignUnallocatedLot,
  countOpenUnallocatedLots,
  listUnallocatedSupply,
  sumOpenUnallocatedQtyFiltered,
} from '../lib/inventory-dest-allocation-store.js';
import { parseListPagination } from '../lib/list-pagination.js';

export const inventoryUnallocatedRoutes = new Hono();

const MENU = 'inventory.unallocated';

inventoryUnallocatedRoutes.get('/inventory/unallocated', requireMenu(MENU), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const skuId = c.req.query('skuId')?.trim() || undefined;
  const pool = c.req.query('pool') as 'overseas' | 'in_transit' | 'local' | undefined;
  const q = c.req.query('q')?.trim() || undefined;
  const filters = { skuId, pool: pool || undefined, q };
  const [items, total, openQty] = await Promise.all([
    listUnallocatedSupply({ ...filters, limit: pageSize, offset }),
    countOpenUnallocatedLots(filters),
    sumOpenUnallocatedQtyFiltered(filters),
  ]);
  return c.json({ items, total, page, pageSize, count: total, openCount: total, openQty });
});

inventoryUnallocatedRoutes.post(
  '/inventory/unallocated/:id/assign',
  requireMenu(MENU),
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{
      assignments?: Array<{ warehouseCode?: string; qty?: number }>;
    }>();
    const assignments = (body.assignments ?? []).map((row) => ({
      warehouseCode: String(row.warehouseCode ?? ''),
      qty: Number(row.qty),
    }));

    try {
      const result = await assignUnallocatedLot({
        lotId: c.req.param('id'),
        assignments,
        userId: user.id,
      });
      if (!result) return c.json({ message: 'Lot not found' }, 404);

      await writeAuditLog(c, {
        action: 'inventory_dest_allocation.assign',
        resourceType: 'inventory_supply_lot',
        resourceId: c.req.param('id'),
        detail: { assignments, destCount: result.items.length },
        user,
      });

      return c.json(result);
    } catch (err) {
      return c.json(
        { message: err instanceof Error ? err.message : 'assign failed' },
        400,
      );
    }
  },
);
