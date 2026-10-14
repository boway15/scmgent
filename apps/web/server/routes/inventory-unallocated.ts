import { Hono } from 'hono';
import { requireMenu } from '../lib/rbac.js';
import { analysisOnlyResponse } from '../lib/analysis-only.js';
import {
  countOpenUnallocatedLots,
  listUnallocatedSupply,
  sumOpenUnallocatedQtyFiltered,
} from '../lib/inventory-dest-allocation-store.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { parseProductScope } from '../lib/planning-accessory-filter.js';

export const inventoryUnallocatedRoutes = new Hono();

const MENU = 'inventory.pools';

inventoryUnallocatedRoutes.get('/inventory/unallocated', requireMenu(MENU), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const skuId = c.req.query('skuId')?.trim() || undefined;
  const pool = c.req.query('pool') as 'overseas' | 'in_transit' | 'local' | undefined;
  const q = c.req.query('q')?.trim() || undefined;
  const productScope = parseProductScope(c.req.query('productScope'));
  const filters = { skuId, pool: pool || undefined, q, productScope };
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
  async (c) => analysisOnlyResponse(c),
);
