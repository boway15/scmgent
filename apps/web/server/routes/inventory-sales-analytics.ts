import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import {
  rebuildInventorySalesCube,
  getInventorySalesCubeStatus,
  listInventorySalesCubeRows,
  getInventorySalesCubeSkuDetail,
} from '../lib/inventory-sales-cube.js';
import { createDownloadJob, DownloadJobLimitError } from '../lib/download-jobs.js';
import { kickDownloadWorker } from '../lib/download-worker.js';
import { parseListPagination } from '../lib/list-pagination.js';

export const inventorySalesAnalyticsRoutes = new Hono();

const MENU = 'data.inventory_sales_analytics';

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/status',
  requireMenu(MENU),
  async (c) => c.json(await getInventorySalesCubeStatus()),
);

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/rows',
  requireMenu(MENU),
  async (c) => {
    const { page, pageSize } = parseListPagination(
      c.req.query('page')?.trim(),
      c.req.query('pageSize')?.trim(),
      20,
    );
    const result = await listInventorySalesCubeRows({
      q: c.req.query('q')?.trim(),
      warehouseCode: c.req.query('warehouseCode')?.trim(),
      category: c.req.query('category')?.trim(),
      lifecycle: c.req.query('lifecycle')?.trim(),
      primaryRisk: c.req.query('primaryRisk')?.trim(),
      productScope: c.req.query('productScope')?.trim(),
      salesCountry: c.req.query('salesCountry')?.trim(),
      page,
      pageSize,
    });
    return c.json(result);
  },
);

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/sku/:skuId',
  requireMenu(MENU),
  async (c) => c.json(await getInventorySalesCubeSkuDetail(c.req.param('skuId'))),
);

inventorySalesAnalyticsRoutes.post(
  '/inventory-sales-analytics/rebuild',
  requireMenu(MENU),
  async (c) => {
    const user = await getCurrentUser(c);
    try {
      const result = await rebuildInventorySalesCube({ actorId: user.id });
      // skipped（源周转未发布）正常返回 200 + result body；并发冲突由下方 catch 映射 409。
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'rebuild failed';
      if (/running|进行中|already running/i.test(msg)) return c.json({ message: msg }, 409);
      throw err;
    }
  },
);

inventorySalesAnalyticsRoutes.post(
  '/inventory-sales-analytics/export',
  requireMenu(MENU),
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json().catch(() => ({}));
    const date = new Date().toISOString().slice(0, 10);
    try {
      const created = await createDownloadJob({
        userId: user.id,
        jobType: 'inventory_sales_analytics',
        title: `存销分析导出-${date}`,
        fileName: `inventory-sales-analytics-${date}.csv`,
        params: body ?? {},
      });
      kickDownloadWorker();
      return c.json(
        { jobId: created.id, status: created.status, downloadCenterPath: '/downloads' },
        202,
      );
    } catch (err) {
      if (err instanceof DownloadJobLimitError) {
        return c.json({ message: err.message }, 429);
      }
      throw err;
    }
  },
);
